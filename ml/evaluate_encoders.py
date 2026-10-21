"""Compare sentence-embedding models on this CV, as the browser would run them.

    npm run eval

Each candidate is the quantised ONNX file Transformers.js would download, at a pinned
commit, embedding questions after the same acronym expansion the page applies. Scores:

    recall@3, MRR  dense retrieval over every passage, for paraphrased recruiter questions
    separation     share of questions (answerable and not) on the right side of the best
                   single similarity threshold, and that threshold
    sections       zero-shot: share of drawn passages nearest their own section's description

Questions live in eval/questions.json and were written before any model was measured.
Writes eval/results.md.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import build_map as bm
from query_fixtures import ACRONYMS_PATH, expand

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

EVAL_DIR = Path(__file__).with_name("eval")
QUESTIONS_PATH = EVAL_DIR / "questions.json"
RESULTS_PATH = EVAL_DIR / "results.md"
TOP_K = 3

SEARCH_INSTRUCTION = "Represent this sentence for searching relevant passages: "
CANDIDATES: dict[str, bm.Encoder] = {
    "MiniLM-L6 (current)": bm.ENCODER,
    "gte-small": bm.Encoder("Xenova/gte-small", "5927d1727bb12db490052a1b33265ad78058de08"),
    "bge-small-en-v1.5": bm.Encoder(
        "Xenova/bge-small-en-v1.5",
        "ea104dacec62c0de699686887e3f920caeb4f3e3",
        pooling="cls",
        query_prefix=SEARCH_INSTRUCTION,
    ),
    "arctic-embed-s": bm.Encoder(
        "Snowflake/snowflake-arctic-embed-s",
        "e596f507467533e48a2e17c007f0e1dacc837b33",
        pooling="cls",
        query_prefix=SEARCH_INSTRUCTION,
    ),
    "e5-small-v2": bm.Encoder(
        "Xenova/e5-small-v2",
        "02af79985278377e65c724a76275707cb0333c70",
        query_prefix="query: ",
        passage_prefix="passage: ",
    ),
}


# ---------------------------------------------------------------- metrics (pure)


def best_rank(scores: NDArray[np.floating], titles: list[str], answers: list[str]) -> int:
    """1-based rank of the highest-scoring passage whose title is one of the answers."""
    import numpy as np

    order = [titles[i] for i in np.argsort(-scores, kind="stable")]
    return min(order.index(a) for a in answers) + 1


def recall_and_mrr(ranks: list[int], k: int) -> tuple[float, float]:
    return sum(r <= k for r in ranks) / len(ranks), sum(1 / r for r in ranks) / len(ranks)


def best_threshold(answerable: list[float], unanswerable: list[float]) -> tuple[float, float]:
    """The similarity cut-off that sorts the most questions correctly, and the share it gets right.

    Answerable questions should reach it with their best match; unanswerable ones shouldn't.
    """
    best = (0.0, -1.0)
    for t in sorted({*answerable, *unanswerable}):
        right = sum(s >= t for s in answerable) + sum(s < t for s in unanswerable)
        accuracy = right / (len(answerable) + len(unanswerable))
        if accuracy > best[1]:
            best = (t, accuracy)
    return best


def zero_shot(passages: NDArray[np.floating], labels: NDArray[np.floating], truth: list[int]) -> float:
    """Share of passages whose most similar label vector is their own theme's."""
    picked = (passages @ labels.T).argmax(axis=1)
    return float(sum(int(p) == t for p, t in zip(picked, truth, strict=True)) / len(truth))


# ---------------------------------------------------------------- evaluation


def evaluate(encoder: bm.Encoder, cv: dict[str, Any], themes: list[bm.Theme], questions: dict) -> dict[str, float]:
    import os

    terms = json.loads(ACRONYMS_PATH.read_text())["terms"]
    ask = [expand(q["q"], terms) for q in questions["answerable"]]
    off = [expand(q, terms) for q in questions["unanswerable"]]

    passages = bm.collect_passages(cv, themes)
    titles = [p["title"] for p in passages]
    docs = bm.embed([p["text"] for p in passages], encoder)
    sims = bm.embed(ask, encoder, queries=True) @ docs.T
    off_sims = bm.embed(off, encoder, queries=True) @ docs.T

    ranks = [best_rank(row, titles, q["answers"]) for row, q in zip(sims, questions["answerable"], strict=True)]
    recall, mrr = recall_and_mrr(ranks, TOP_K)
    threshold, separation = best_threshold(sims.max(axis=1).tolist(), off_sims.max(axis=1).tolist())

    drawn = [i for i, p in enumerate(passages) if bm.is_drawn(p)]
    descriptions = bm.embed([f"{t['name']}: {t['summary']}" for t in themes], encoder, queries=True)
    sections = zero_shot(docs[drawn], descriptions, [passages[i]["theme"] for i in drawn])

    size_mb = os.path.getsize(bm.model_file(encoder, encoder.file)) / 1e6
    return {
        "size_mb": size_mb,
        "recall": recall,
        "mrr": mrr,
        "separation": separation,
        "threshold": threshold,
        "sections": sections,
    }


def table(results: dict[str, dict[str, float]], n_answerable: int, n_unanswerable: int) -> str:
    rows = [
        f"| {name} | {r['size_mb']:.0f} MB | {r['recall']:.2f} | {r['mrr']:.2f} | {r['separation']:.2f} "
        f"| {r['threshold']:.2f} | {r['sections']:.2f} |"
        for name, r in results.items()
    ]
    return "\n".join(
        [
            "# Embedding models on this CV",
            "",
            f"Generated by `npm run eval` from {n_answerable} answerable and {n_unanswerable} unanswerable "
            "questions (ml/eval/questions.json). Dense retrieval only; the page also runs keyword search.",
            "",
            f"| Model | Download | Recall@{TOP_K} | MRR | Separation | Threshold | Sections |",
            "|---|---|---|---|---|---|---|",
            *rows,
            "",
        ]
    )


def main() -> None:
    cv = json.loads(bm.CV_PATH.read_text())
    themes = bm.load_themes(bm.THEMES_PATH)
    questions = json.loads(QUESTIONS_PATH.read_text())
    results = {}
    for name, encoder in CANDIDATES.items():
        results[name] = evaluate(encoder, cv, themes, questions)
        print(f"{name}: " + ", ".join(f"{k} {v:.2f}" for k, v in results[name].items()), flush=True)
    RESULTS_PATH.write_text(table(results, len(questions["answerable"]), len(questions["unanswerable"])))
    print(f"Wrote {RESULTS_PATH.relative_to(bm.ROOT)}")


if __name__ == "__main__":
    main()
