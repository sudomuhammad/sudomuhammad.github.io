"""Build the portfolio's embedding map from the CV.

Usage (from the repo root):

    npm run map          # rebuild src/data/map.json
    npm run map:check    # exit 1 if map.json is out of date

Pipeline:
    CV passages
      -> MiniLM sentence embeddings (the same quantised ONNX file the browser
         loads, so visitors' query vectors line up with these)
      -> UMAP to 5D -> HDBSCAN clusters
      -> UMAP to 2D for the drawn layout
      -> c-TF-IDF terms per cluster, used to suggest names

Cluster names are human-approved in src/data/clusters.json and matched to the
discovered clusters by their top terms, so a rebuild that renumbers clusters
keeps its names. The output is committed; CI only runs --check.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, TypedDict

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

ROOT = Path(__file__).resolve().parent.parent
CV_PATH = ROOT / "src/data/cv.json"
NAMES_PATH = ROOT / "src/data/clusters.json"
OUT_PATH = ROOT / "src/data/map.json"

# The browser loads exactly this file via Transformers.js; keep both in sync.
MODEL_REPO = "Xenova/all-MiniLM-L6-v2"
MODEL_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9"
MODEL_FILE = "onnx/model_quantized.onnx"
# MiniLM was trained on sequences up to 256 tokens; every CV passage is far shorter.
MAX_TOKENS = 256


@dataclass(frozen=True)
class Tuning:
    """Hyperparameters, tuned for a corpus of roughly 30-60 short passages."""

    seed: int = 42
    # Neighbourhood size for UMAP. Below ~10 the corpus splits into two halves;
    # above it, small clusters (e.g. databases) merge into their neighbours.
    n_neighbors: int = 10
    cluster_dims: int = 5
    # Smallest group HDBSCAN may call a cluster; a role's 4-5 passages can form one.
    min_cluster_size: int = 4
    min_samples: int = 2
    layout_min_dist: float = 0.4
    layout_spread: float = 1.2
    top_terms: int = 6
    # Top terms a discovered cluster must share with an approved name to inherit it.
    min_name_overlap: int = 2
    # Radius step (map units) for fanning out skills that land on the same point.
    coincident_spread: float = 0.018


TUNING = Tuning()

PassageKind = Literal["context", "point", "tools", "skills", "education", "fact"]
# Kinds that are searchable but not part of the map: they describe the person, not work.
OFF_MAP_KINDS: frozenset[str] = frozenset({"fact"})
# Kinds that are comma-separated lists; they'd "mention" every term they list.
LIST_KINDS: frozenset[str] = frozenset({"tools", "skills"})


class Passage(TypedDict, total=False):
    id: int
    kind: PassageKind
    title: str  # short name drawn on the map; not embedded
    text: str
    source: str
    x: float | None
    y: float | None
    cluster: int | None
    outlier: bool
    tokens: int  # MiniLM WordPiece tokens in `text`


class NamedCluster(TypedDict):
    key: str  # stable slug for URLs (#agents) and styling; survives renaming and re-clustering
    name: str
    summary: str
    color: str
    terms: list[str]


# Shown for a discovered cluster until it's given an approved name.
PLACEHOLDER_COLOR = "#9AA1AB"


# ---------------------------------------------------------------- inputs


def source_hash(*paths: Path) -> str:
    """Short hash of every input that affects the output, for --check."""
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes() if path.exists() else b"")
    return digest.hexdigest()[:16]


def input_paths() -> tuple[Path, ...]:
    return (CV_PATH, NAMES_PATH, Path(__file__))


def collect_passages(cv: dict[str, Any]) -> list[Passage]:
    """Flatten the CV into short, self-contained passages to embed.

    Only `text` is embedded; `title` is the short name drawn on the map. Bullet
    points carry hand-written titles; other kinds get one derived from the CV.
    """
    passages: list[Passage] = []
    for role in cv["roles"]:
        source = f"{role['title']}, {role['org']}"
        passages.append({"kind": "context", "title": role["org"], "text": role["context"], "source": source})
        passages.extend(
            {"kind": "point", "title": point["title"], "text": point["text"], "source": source}
            for point in role["points"]
        )
        tools = ", ".join(role["tech"])
        passages.append(
            {
                "kind": "tools",
                "title": f"{role['org']} toolkit",
                "text": f"Tools used as {role['title']} at {role['org']}: {tools}.",
                "source": source,
            }
        )
    for edu in cv["education"]:
        text = f"{edu['degree']}, {edu['org']}."
        if edu.get("note"):
            text += f" {edu['note']}"
        passages.append({"kind": "education", "title": edu["degree"], "text": text, "source": edu["degree"]})
    for skill in cv.get("skills", []):
        items = ", ".join(skill["items"])
        passages.append(
            {
                "kind": "skills",
                "title": skill["group"],
                "text": f"{skill['group']}: {items}.",
                "source": f"Skills: {skill['group']}",
            }
        )
    passages.extend({"kind": "fact", "title": "About", "text": fact, "source": "About"} for fact in cv["facts"])
    for i, passage in enumerate(passages):
        passage["id"] = i
    return passages


def load_approved_names(path: Path) -> list[NamedCluster]:
    if not path.exists():
        return []
    return json.loads(path.read_text())["clusters"]


# ---------------------------------------------------------------- ML steps


@cache
def model_file(filename: str) -> str:
    """Local path to a file from the pinned model revision (downloaded once, then cached)."""
    from huggingface_hub import hf_hub_download

    return hf_hub_download(MODEL_REPO, filename, revision=MODEL_REVISION)


@cache
def onnx_session():
    """The quantised MiniLM model, loaded once per process."""
    import onnxruntime as ort

    return ort.InferenceSession(model_file(MODEL_FILE), providers=["CPUExecutionProvider"])


def load_tokenizer():
    """A fresh MiniLM WordPiece tokenizer. Not cached: callers configure padding differently."""
    from tokenizers import Tokenizer

    tokenizer = Tokenizer.from_file(model_file("tokenizer.json"))
    # The shipped tokenizer.json pads and truncates to 128 tokens; counting needs the raw split.
    tokenizer.no_padding()
    tokenizer.no_truncation()
    return tokenizer


def embed(texts: list[str]) -> NDArray[np.float32]:
    """Embed texts as unit vectors, matching Transformers.js `{ pooling: 'mean', normalize: true }`."""
    import numpy as np

    session = onnx_session()
    tokenizer = load_tokenizer()
    tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
    tokenizer.enable_truncation(max_length=MAX_TOKENS)

    encoded = tokenizer.encode_batch(texts)
    input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
    attention_mask = np.array([e.attention_mask for e in encoded], dtype=np.int64)
    feeds = {"input_ids": input_ids, "attention_mask": attention_mask}
    if "token_type_ids" in {i.name for i in session.get_inputs()}:
        feeds["token_type_ids"] = np.zeros_like(input_ids)
    hidden = session.run(None, feeds)[0]

    mask = attention_mask[..., None].astype(np.float32)
    pooled = (hidden * mask).sum(axis=1) / np.clip(mask.sum(axis=1), 1e-9, None)
    return normalise_rows(pooled)


def normalise_rows(matrix: NDArray[np.floating]) -> NDArray[np.float32]:
    import numpy as np

    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return (matrix / np.clip(norms, 1e-12, None)).astype(np.float32)


def reduce(vectors: NDArray[np.float32], dims: int, min_dist: float, spread: float = 1.0) -> NDArray[np.float32]:
    import umap

    # n_jobs=1 with a fixed seed is what makes UMAP deterministic between runs.
    return umap.UMAP(
        n_neighbors=TUNING.n_neighbors,
        n_components=dims,
        min_dist=min_dist,
        spread=spread,
        metric="cosine",
        random_state=TUNING.seed,
        n_jobs=1,
    ).fit_transform(vectors)


def cluster(vectors: NDArray[np.float32]) -> tuple[NDArray[np.int_], NDArray[np.bool_]]:
    """HDBSCAN clusters, with noise points attached to their most similar cluster.

    Returns (labels, is_core); is_core is False for points HDBSCAN called noise.
    """
    from sklearn.cluster import HDBSCAN

    reduced = reduce(vectors, dims=TUNING.cluster_dims, min_dist=0.0)
    labels = HDBSCAN(min_cluster_size=TUNING.min_cluster_size, min_samples=TUNING.min_samples).fit_predict(reduced)
    is_core = labels >= 0
    if not is_core.any():
        raise RuntimeError("HDBSCAN found no clusters; lower min_cluster_size in Tuning.")
    return attach_noise(vectors, labels, is_core), is_core


def attach_noise(
    vectors: NDArray[np.float32], labels: NDArray[np.int_], is_core: NDArray[np.bool_]
) -> NDArray[np.int_]:
    """Give each noise point the label of the cluster whose centroid is most cosine-similar."""
    import numpy as np

    ids = np.unique(labels[is_core])
    centroids = normalise_rows(np.stack([vectors[labels == c].mean(axis=0) for c in ids]))
    out = labels.copy()
    noise = ~is_core
    if noise.any():
        out[noise] = ids[(vectors[noise] @ centroids.T).argmax(axis=1)]
    return out


def layout(vectors: NDArray[np.float32]) -> NDArray[np.float32]:
    """2D positions scaled to the unit square."""
    import numpy as np

    xy = reduce(vectors, dims=2, min_dist=TUNING.layout_min_dist, spread=TUNING.layout_spread)
    span = np.ptp(xy, axis=0)
    return (xy - xy.min(axis=0)) / np.where(span > 0, span, 1)


def cluster_terms(texts: list[str], labels: list[int], top_n: int) -> dict[int, list[str]]:
    """c-TF-IDF: treat each cluster as one document and rank its most distinctive terms."""
    from sklearn.feature_extraction.text import TfidfVectorizer

    ids = sorted(set(labels))
    docs = [" ".join(t for t, c in zip(texts, labels, strict=True) if c == cid) for cid in ids]
    vectoriser = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True)
    matrix = vectoriser.fit_transform(docs).toarray()
    vocab = vectoriser.get_feature_names_out()
    return {cid: [str(vocab[i]) for i in row.argsort()[::-1][:top_n]] for cid, row in zip(ids, matrix, strict=True)}


# ---------------------------------------------------------------- naming and labels


def match_names(terms: dict[int, list[str]], approved: list[NamedCluster], min_overlap: int) -> dict[int, dict]:
    """Assign approved names to discovered clusters, best term overlap first.

    Pairs are taken greedily from the highest overlap down, so the result doesn't
    depend on cluster numbering. Unmatched clusters get a placeholder from their terms.
    """
    pairs = sorted(
        (
            (len(set(top) & set(entry["terms"])), cid, i)
            for cid, top in terms.items()
            for i, entry in enumerate(approved)
        ),
        reverse=True,
    )
    out: dict[int, dict] = {}
    used: set[int] = set()
    for overlap, cid, i in pairs:
        if overlap < min_overlap or cid in out or i in used:
            continue
        entry = approved[i]
        out[cid] = {
            "key": entry["key"],
            "name": entry["name"],
            "summary": entry["summary"],
            "color": entry["color"],
            "approved": True,
        }
        used.add(i)
    for cid, top in terms.items():
        out.setdefault(
            cid,
            {
                "key": f"cluster-{cid}",
                "name": ", ".join(top[:3]),
                "summary": "",
                "color": PLACEHOLDER_COLOR,
                "approved": False,
            },
        )
    return out


def skill_labels(cv: dict[str, Any], passages: list[Passage]) -> list[dict[str, Any]]:
    """Place each tool or skill at the centre of the map passages that are evidence for it.

    Evidence, in order of preference:
      1. prose passages that name it (bullets, role context, education);
      2. the bullet points of roles that list it as a tool;
      3. the skills-group passage that lists it.
    Terms with no evidence are skipped rather than placed at a made-up position.
    """
    from collections import Counter

    on_map = [p for p in passages if p.get("x") is not None]
    role_terms = [t for role in cv["roles"] for t in role["tech"]]
    skill_terms = [t for skill in cv.get("skills", []) for t in skill["items"]]
    labels = []
    for term in dict.fromkeys(role_terms + skill_terms):
        pattern = re.compile(rf"(?<!\w){re.escape(term)}(?!\w)", re.IGNORECASE)
        hits = [p for p in on_map if p["kind"] not in LIST_KINDS and pattern.search(p["text"])]
        if not hits:
            roles = {f"{r['title']}, {r['org']}" for r in cv["roles"] if term in r["tech"]}
            hits = [p for p in on_map if p["kind"] == "point" and p["source"] in roles]
        if not hits:
            groups = {f"Skills: {s['group']}" for s in cv.get("skills", []) if term in s["items"]}
            hits = [p for p in on_map if p["kind"] == "skills" and p["source"] in groups]
        if not hits:
            continue
        labels.append(
            {
                "term": term,
                "x": round(sum(p["x"] for p in hits) / len(hits), 4),
                "y": round(sum(p["y"] for p in hits) / len(hits), 4),
                "cluster": Counter(p["cluster"] for p in hits).most_common(1)[0][0],
                "passages": [p["id"] for p in hits],
            }
        )
    return spread_coincident(labels, TUNING.coincident_spread)


GOLDEN_ANGLE = math.pi * (3 - math.sqrt(5))


def spread_coincident(labels: list[dict[str, Any]], step: float) -> list[dict[str, Any]]:
    """Fan out labels that share a position on a small golden-angle spiral around it.

    Skills with the same evidence (e.g. several listed only in one skills group)
    would otherwise sit on one pixel and could never be labelled apart. Labels
    alone at their position are left untouched; the spread is a few thousandths
    of the map, so each stays beside its evidence.
    """
    groups: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for label in labels:
        groups.setdefault((label["x"], label["y"]), []).append(label)
    for (x, y), group in groups.items():
        if len(group) < 2:
            continue
        for k, label in enumerate(group):
            radius = step * math.sqrt(k + 0.5)
            label["x"] = round(x + radius * math.cos(k * GOLDEN_ANGLE), 4)
            label["y"] = round(y + radius * math.sin(k * GOLDEN_ANGLE), 4)
    return labels


def wordpieces(text: str, tokenizer) -> list[str]:
    """The WordPiece split of `text` (no special tokens), e.g. ['muhammad', 'u', '##zai', '##r']."""
    pieces = tokenizer.encode(text, add_special_tokens=False).tokens
    if "[PAD]" in pieces:
        raise RuntimeError("Tokenizer is padding; token counts would be wrong. Call load_tokenizer().")
    return pieces


def quantise(vectors: NDArray[np.float32]) -> str:
    """Unit vectors as base64 int8 (value * 127): a quarter of the size, ranking unchanged."""
    import numpy as np

    return base64.b64encode(np.clip(np.round(vectors * 127), -127, 127).astype(np.int8).tobytes()).decode()


# ---------------------------------------------------------------- build


def build(cv: dict[str, Any], approved: list[NamedCluster]) -> dict[str, Any]:
    import numpy as np

    passages = collect_passages(cv)
    vectors = embed([p["text"] for p in passages])
    tokenizer = load_tokenizer()

    on_map = np.array([p["kind"] not in OFF_MAP_KINDS for p in passages])
    map_vectors = vectors[on_map]
    labels, is_core = cluster(map_vectors)
    xy = layout(map_vectors)

    map_passages = [p for p, shown in zip(passages, on_map, strict=True) if shown]
    for p, (x, y), label, core in zip(map_passages, xy, labels, is_core, strict=True):
        p.update(x=round(float(x), 4), y=round(float(y), 4), cluster=int(label), outlier=not bool(core))
    for p in passages:
        p.setdefault("x", None)
        p.setdefault("y", None)
        p.setdefault("cluster", None)
        p.setdefault("outlier", False)
        p["tokens"] = len(wordpieces(p["text"], tokenizer))  # for the page's reading meter

    terms = cluster_terms([p["text"] for p in map_passages], [int(c) for c in labels], TUNING.top_terms)
    names = match_names(terms, approved, TUNING.min_name_overlap)

    return {
        "generated": "by ml/build_map.py; do not edit by hand",
        "sourceHash": source_hash(*input_paths()),
        "model": {"repo": MODEL_REPO, "revision": MODEL_REVISION, "file": MODEL_FILE, "dims": int(vectors.shape[1])},
        "clusters": [
            {"id": cid, "size": int((labels == cid).sum()), "terms": terms[cid], **names[cid]} for cid in sorted(terms)
        ],
        "passages": passages,
        "labels": skill_labels(cv, passages),
        "vectors": quantise(vectors),
        "introTokens": {
            "name": wordpieces(cv["person"]["name"], tokenizer),
            "line": wordpieces(cv["person"]["line"], tokenizer),
        },
    }


def check(out_path: Path) -> int:
    """Exit status for CI: 0 if the committed map matches its inputs."""
    current = json.loads(out_path.read_text()).get("sourceHash") if out_path.exists() else None
    if current != source_hash(*input_paths()):
        print(f"{out_path.relative_to(ROOT)} is out of date: run `npm run map` and commit it.", file=sys.stderr)
        return 1
    print(f"{out_path.relative_to(ROOT)} is up to date.")
    return 0


def report(data: dict[str, Any], out_path: Path) -> None:
    print(f"Wrote {out_path.relative_to(ROOT)}: {len(data['passages'])} passages, {len(data['clusters'])} clusters")
    for c in data["clusters"]:
        flag = "" if c["approved"] else "  (name needs approval in src/data/clusters.json)"
        print(f"  [{c['id']}] {c['size']:>2} passages  {c['name']}{flag}")
        print(f"       terms: {', '.join(c['terms'])}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the portfolio's embedding map from the CV.")
    parser.add_argument("--check", action="store_true", help="exit 1 if map.json is out of date (no ML run)")
    args = parser.parse_args(argv)

    if args.check:
        return check(OUT_PATH)

    data = build(json.loads(CV_PATH.read_text()), load_approved_names(NAMES_PATH))
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    report(data, OUT_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
