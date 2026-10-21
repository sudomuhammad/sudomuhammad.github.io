"""Build the portfolio's embedding map from the CV.

Usage (from the repo root):

    npm run map          # rebuild src/data/map.json
    npm run map:check    # exit 1 if map.json is out of date

Pipeline:
    CV passages
      -> MiniLM sentence embeddings (the same quantised ONNX file the browser
         loads, so visitors' query vectors line up with these)
      -> UMAP to 2D for the drawn layout

Positions come from the embeddings; colours don't. Each CV item is tagged by hand
with a theme from src/data/themes.json, because clustering ~40 short passages
grouped them by shared words rather than by the work. Tagged prose is drawn; lists
(tools, skills) and facts are searchable only. The output is committed; CI only
runs --check.
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
THEMES_PATH = ROOT / "src/data/themes.json"
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
    # above it, small groups (e.g. databases) merge into their neighbours.
    n_neighbors: int = 10
    layout_min_dist: float = 0.4
    layout_spread: float = 1.2
    # Radius step (map units) for fanning out skills that land on the same point.
    coincident_spread: float = 0.018


TUNING = Tuning()

PassageKind = Literal["context", "point", "tools", "skills", "education", "fact"]
# Kinds that are comma-separated lists. They're searchable but never drawn: a list of
# names would pull the layout towards shared tools rather than shared work.
LIST_KINDS: frozenset[str] = frozenset({"tools", "skills"})


def is_drawn(passage: Passage) -> bool:
    """Whether a passage gets a place on the map: tagged with a theme, and prose rather than a list."""
    return passage["theme"] is not None and passage["kind"] not in LIST_KINDS


class Passage(TypedDict, total=False):
    id: int
    kind: PassageKind
    title: str  # short name drawn on the map; not embedded
    text: str
    source: str
    theme: int | None  # index into the themes; None for untagged passages (facts, the BSc)
    x: float | None
    y: float | None
    tokens: int  # MiniLM WordPiece tokens in `text`


class Theme(TypedDict):
    key: str  # what cv.json tags items with
    name: str
    summary: str
    color: str


# ---------------------------------------------------------------- inputs


def source_hash(*paths: Path) -> str:
    """Short hash of every input that affects the output, for --check."""
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes() if path.exists() else b"")
    return digest.hexdigest()[:16]


def input_paths() -> tuple[Path, ...]:
    return (CV_PATH, THEMES_PATH, Path(__file__))


def collect_passages(cv: dict[str, Any], themes: list[Theme]) -> list[Passage]:
    """Flatten the CV into short, self-contained passages to embed.

    Only `text` is embedded; `title` is the short name drawn on the map. Bullet
    points carry hand-written titles; other kinds get one derived from the CV.
    A role's points take the role's theme unless they name their own.
    """
    index = {t["key"]: i for i, t in enumerate(themes)}

    def theme_of(item: dict[str, Any], default: str | None = None) -> int | None:
        key = item.get("theme", default)
        if key is not None and key not in index:
            raise ValueError(f"cv.json: unknown theme {key!r}; themes.json has {', '.join(index)}")
        return None if key is None else index[key]

    passages: list[Passage] = []
    for role in cv["roles"]:
        source = f"{role['title']}, {role['org']}"
        theme = theme_of(role)
        passages.append(
            {"kind": "context", "title": role["org"], "text": role["context"], "source": source, "theme": theme}
        )
        passages.extend(
            {
                "kind": "point",
                "title": point["title"],
                "text": point["text"],
                "source": source,
                "theme": theme_of(point, role.get("theme")),
            }
            for point in role["points"]
        )
        tools = ", ".join(role["tech"])
        passages.append(
            {
                "kind": "tools",
                "title": f"{role['org']} toolkit",
                "text": f"Tools used as {role['title']} at {role['org']}: {tools}.",
                "source": source,
                "theme": theme,
            }
        )
    for edu in cv["education"]:
        text = f"{edu['degree']}, {edu['org']}."
        if edu.get("note"):
            text += f" {edu['note']}"
        passages.append(
            {"kind": "education", "title": edu["degree"], "text": text, "source": edu["degree"], "theme": theme_of(edu)}
        )
    for skill in cv.get("skills", []):
        theme = theme_of(skill)
        name = themes[theme]["name"]
        items = ", ".join(skill["items"])
        passages.append(
            {"kind": "skills", "title": name, "text": f"{name}: {items}.", "source": f"Skills: {name}", "theme": theme}
        )
    passages.extend(
        {"kind": "fact", "title": "About", "text": fact, "source": "About", "theme": None} for fact in cv["facts"]
    )
    for i, passage in enumerate(passages):
        passage["id"] = i
    return passages


def load_themes(path: Path) -> list[Theme]:
    return json.loads(path.read_text())["themes"]


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


def layout(vectors: NDArray[np.float32]) -> NDArray[np.float32]:
    """2D positions scaled to the unit square."""
    import numpy as np

    xy = reduce(vectors, dims=2, min_dist=TUNING.layout_min_dist, spread=TUNING.layout_spread)
    span = np.ptp(xy, axis=0)
    return (xy - xy.min(axis=0)) / np.where(span > 0, span, 1)


# ---------------------------------------------------------------- labels


def skill_labels(cv: dict[str, Any], passages: list[Passage]) -> list[dict[str, Any]]:
    """Place each skill from cv.json's skills lists among the evidence for it in its own theme.

    Only the curated skills are labelled (a role's full tech list stays in the CV). A skill
    takes the theme of the list it's in, and only that theme's drawn passages count as
    evidence, so when the page zooms to a theme every one of its skills is in frame.

    Evidence, in order of preference:
      1. passages in the theme that name it (bullets, role context, education);
      2. the theme's bullet points from roles that list it as a tool (or the role's
         context, for a role with no bullets).
    A skill with neither sits at the centre of its theme, with no evidence passages.
    """
    on_map = [p for p in passages if p.get("x") is not None]
    skill_passages = [p for p in passages if p["kind"] == "skills"]  # one per cv.json skills entry, in order
    skills = cv.get("skills", [])
    theme_of = {term: p["theme"] for p, skill in zip(skill_passages, skills, strict=True) for term in skill["items"]}
    labels = []
    for term, theme in theme_of.items():
        mine = [p for p in on_map if p["theme"] == theme]
        if not mine:
            continue  # nothing drawn in this theme, so nowhere honest to put it
        pattern = re.compile(rf"(?<!\w){re.escape(term)}(?!\w)", re.IGNORECASE)
        hits = [p for p in mine if pattern.search(p["text"])]
        if not hits:
            for role in cv["roles"]:
                if term in role["tech"]:
                    kind = "point" if role["points"] else "context"
                    hits += [p for p in mine if p["kind"] == kind and p["source"] == f"{role['title']}, {role['org']}"]
        placed_by = hits or mine
        labels.append(
            {
                "term": term,
                "x": round(sum(p["x"] for p in placed_by) / len(placed_by), 4),
                "y": round(sum(p["y"] for p in placed_by) / len(placed_by), 4),
                "theme": theme,
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


def build(cv: dict[str, Any], themes: list[Theme]) -> dict[str, Any]:
    import numpy as np

    passages = collect_passages(cv, themes)
    vectors = embed([p["text"] for p in passages])
    tokenizer = load_tokenizer()

    on_map = np.array([is_drawn(p) for p in passages])
    xy = layout(vectors[on_map])

    map_passages = [p for p, shown in zip(passages, on_map, strict=True) if shown]
    for p, (x, y) in zip(map_passages, xy, strict=True):
        p.update(x=round(float(x), 4), y=round(float(y), 4))
    for p in passages:
        p.setdefault("x", None)
        p.setdefault("y", None)
        p["tokens"] = len(wordpieces(p["text"], tokenizer))  # for the page's reading meter

    return {
        "generated": "by ml/build_map.py; do not edit by hand",
        "sourceHash": source_hash(*input_paths()),
        "model": {"repo": MODEL_REPO, "revision": MODEL_REVISION, "file": MODEL_FILE, "dims": int(vectors.shape[1])},
        "themes": [
            {"id": i, **theme, "size": sum(p["theme"] == i for p in map_passages)} for i, theme in enumerate(themes)
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
    print(f"Wrote {out_path.relative_to(ROOT)}: {len(data['passages'])} passages, {len(data['labels'])} skills")
    for t in data["themes"]:
        print(f"  {t['size']:>2} passages  {t['name']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the portfolio's embedding map from the CV.")
    parser.add_argument("--check", action="store_true", help="exit 1 if map.json is out of date (no ML run)")
    args = parser.parse_args(argv)

    if args.check:
        return check(OUT_PATH)

    data = build(json.loads(CV_PATH.read_text()), load_themes(THEMES_PATH))
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    report(data, OUT_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
