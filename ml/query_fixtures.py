"""Embed a fixed set of test questions for the browser retrieval tests.

    npm run map:fixtures

Writes src/scripts/search/__fixtures__/queries.json: each question with its MiniLM
vector, made with the same model file as the map, so src/scripts/search/retrieval.test.ts
can test hybrid search end to end without downloading a model.
"""

from __future__ import annotations

import json
import re

import build_map as bm

OUT_PATH = bm.ROOT / "src/scripts/search/__fixtures__/queries.json"
ACRONYMS_PATH = bm.ROOT / "src/data/acronyms.json"

QUESTIONS = [
    "Has he shipped RAG to production?",
    "What agent frameworks does he use?",
    "Is he open to relocation?",
    "When can he start?",
    "Can he deploy on AWS?",
    "prompt caching",
    "favourite pizza topping",
    "Does he know Kubernetes?",
]


def expand(query: str, terms: dict[str, str]) -> str:
    """Mirror of expandQuery() in src/scripts/retrieval.ts; a test checks they agree."""
    return re.sub(r"[\w/+#.-]+", lambda m: terms.get(m.group(0).lower(), m.group(0)), query)


def main() -> None:
    terms = json.loads(ACRONYMS_PATH.read_text())["terms"]
    embedded = [expand(q, terms) for q in QUESTIONS]
    vectors = bm.embed(embedded)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "generated": "by ml/query_fixtures.py; do not edit by hand",
        "model": {"repo": bm.MODEL_REPO, "revision": bm.MODEL_REVISION, "file": bm.MODEL_FILE},
        "queries": [
            {"question": q, "embedded": e, "vector": [round(float(x), 6) for x in v]}
            for q, e, v in zip(QUESTIONS, embedded, vectors, strict=True)
        ],
    }
    OUT_PATH.write_text(json.dumps(data) + "\n")
    print(f"Wrote {OUT_PATH.relative_to(bm.ROOT)}: {len(QUESTIONS)} questions")


if __name__ == "__main__":
    main()
