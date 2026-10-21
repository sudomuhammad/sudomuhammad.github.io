"""Unit tests for the pure parts of build_map (no model download, no UMAP)."""

import base64
import json

import numpy as np
import pytest

import build_map as bm

THEMES: list[bm.Theme] = [
    {"key": "llm", "name": "LLM work", "summary": "", "color": "#f00"},
    {"key": "ml", "name": "ML", "summary": "", "color": "#0f0"},
]

CV = {
    "person": {"line": "I build AI.", "summary": "Five years."},
    "roles": [
        {
            "title": "AI Engineer",
            "org": "Acme",
            "theme": "llm",
            "context": "Builds agents.",
            "points": [
                {"title": "RAG", "text": "Built RAG with Qdrant."},
                {"title": "Deploys", "text": "Deployed with Docker.", "theme": "ml"},
            ],
            "tech": ["Qdrant", "Docker", "Rust", "Go"],
        },
        {"title": "Analyst", "org": "Beta", "theme": "ml", "context": "Reports.", "points": [], "tech": ["Excel"]},
    ],
    "education": [
        {"degree": "MSc AI", "org": "Uni", "theme": "ml", "note": "Thesis on NLP."},
        {"degree": "BSc EE", "org": "Uni"},
    ],
    "skills": [
        {"theme": "llm", "items": ["Qdrant"]},
        {"theme": "ml", "items": ["topic modelling", "Rust", "Excel", "Docker"]},
    ],
    "facts": ["Open to relocation."],
}


def collect(cv=CV):
    return bm.collect_passages(cv, THEMES)


def placed(passages, positions=None):
    """Give drawn passages positions (by id, default the centre), as build() would."""
    for p in passages:
        x, y = (positions or {}).get(p["id"], (0.5, 0.5)) if bm.is_drawn(p) else (None, None)
        p.update(x=x, y=y)
    return passages


def labels_of(cv, passages):
    return {label["term"]: label for label in bm.skill_labels(cv, passages)}


def ids(passages, *titles):
    return [p["id"] for p in passages if p["title"] in titles]


class TestCollectPassages:
    def test_ids_are_sequential_and_kinds_cover_cv(self):
        passages = collect()
        assert [p["id"] for p in passages] == list(range(len(passages)))
        kinds = [p["kind"] for p in passages]
        assert kinds.count("point") == 2
        assert kinds.count("tools") == 2
        assert kinds.count("education") == 2
        assert kinds.count("skills") == 2
        assert kinds.count("fact") == 1

    def test_every_passage_has_a_title(self):
        passages = collect()
        titles = {p["kind"]: p["title"] for p in passages}
        assert [p["title"] for p in passages if p["kind"] == "point"] == ["RAG", "Deploys"]
        assert titles["context"] == "Beta"  # role context is titled by its org
        assert titles["tools"] == "Beta toolkit"
        assert titles["skills"] == "ML"  # skills are titled by their theme
        assert all(p["title"] for p in passages)

    def test_education_note_is_optional(self):
        texts = [p["text"] for p in collect() if p["kind"] == "education"]
        assert texts == ["MSc AI, Uni. Thesis on NLP.", "BSc EE, Uni."]

    def test_points_inherit_the_role_theme_unless_they_name_one(self):
        themes = {p["title"]: p["theme"] for p in collect() if p["kind"] in ("point", "context", "tools")}
        assert themes == {"Acme": 0, "RAG": 0, "Deploys": 1, "Acme toolkit": 0, "Beta": 1, "Beta toolkit": 1}

    def test_only_tagged_prose_is_drawn(self):
        # Untagged passages and lists (tools, skills) stay searchable but get no place on the map.
        hidden = {p["title"] for p in collect() if not bm.is_drawn(p)}
        assert hidden == {"BSc EE", "About", "Acme toolkit", "Beta toolkit", "LLM work", "ML"}

    def test_unknown_theme_fails_loudly(self):
        cv = {**CV, "skills": [{"theme": "nope", "items": []}]}
        with pytest.raises(ValueError, match="unknown theme 'nope'"):
            collect(cv)


class TestSkillLabels:
    def test_placed_at_passages_in_its_theme_that_name_it(self):
        passages = collect()
        rag = ids(passages, "RAG")
        labels = labels_of(CV, placed(passages, {rag[0]: (0.2, 0.4)}))
        assert (labels["Qdrant"]["x"], labels["Qdrant"]["y"], labels["Qdrant"]["passages"]) == (0.2, 0.4, rag)
        assert labels["Qdrant"]["theme"] == 0  # the theme of the list it's in

    def test_mentions_in_another_theme_dont_count(self):
        # Listed under "ml" now, so the "llm" bullet naming it isn't evidence; Acme lists it as a
        # tool, so it falls back to Acme's "ml" bullet instead.
        cv = {**CV, "skills": [{"theme": "ml", "items": ["Qdrant"]}]}
        passages = placed(collect(cv))
        assert labels_of(cv, passages)["Qdrant"]["passages"] == ids(passages, "Deploys")

    def test_unmentioned_tool_falls_back_to_its_roles_points_in_the_theme(self):
        passages = placed(collect())
        assert labels_of(CV, passages)["Rust"]["passages"] == ids(passages, "Deploys")

    def test_role_without_points_falls_back_to_its_context(self):
        passages = placed(collect())
        assert labels_of(CV, passages)["Excel"]["passages"] == ids(passages, "Beta")

    def test_skill_without_evidence_sits_at_the_centre_of_its_theme(self):
        passages = collect()
        beta, deploys, msc = ids(passages, "Beta"), ids(passages, "Deploys"), ids(passages, "MSc AI")
        placed(passages, {beta[0]: (0.1, 0.1), deploys[0]: (0.4, 0.4), msc[0]: (1.0, 1.0)})
        label = labels_of(CV, passages)["topic modelling"]
        # Within the small spread that keeps labels sharing a point apart (see TestSpreadCoincident).
        assert label["passages"] == []
        assert (label["x"], label["y"]) == (pytest.approx(0.5, abs=0.03), pytest.approx(0.5, abs=0.03))

    def test_only_listed_skills_are_labelled(self):
        # "Go" is in a role's tech list but not in any skills list.
        labels = bm.skill_labels(CV, placed(collect()))
        assert "Go" not in {label["term"] for label in labels}
        json.dumps(labels, allow_nan=False)

    def test_word_boundaries_prevent_partial_matches(self):
        tooling = {"title": "Tooling", "text": "Used Dockerfile.", "theme": "ml"}
        cv = {**CV, "roles": [{**CV["roles"][0], "points": [tooling]}]}
        passages = placed(collect(cv))
        # "Dockerfile" is not "Docker"; it still counts as Acme's ml bullet, as a role that lists Docker.
        assert labels_of(cv, passages)["Docker"]["passages"] == ids(passages, "Tooling")


def test_quantise_round_trip_preserves_ranking():
    rng = np.random.default_rng(0)
    vectors = bm.normalise_rows(rng.normal(size=(20, 384)).astype(np.float32))
    decoded = np.frombuffer(base64.b64decode(bm.quantise(vectors)), dtype=np.int8).reshape(20, 384) / 127
    query = vectors[0]
    assert np.argsort(vectors @ query)[-5:].tolist() == np.argsort(decoded @ query)[-5:].tolist()


def test_source_hash_changes_with_any_input(tmp_path):
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_text("{}")
    before = bm.source_hash(a, b)  # b missing counts as empty
    b.write_text('{"clusters": []}')
    assert bm.source_hash(a, b) != before


class TestSpreadCoincident:
    def test_labels_sharing_a_point_get_distinct_nearby_points(self):
        labels = [{"term": t, "x": 0.5, "y": 0.5} for t in "abcd"] + [{"term": "solo", "x": 0.1, "y": 0.9}]
        out = bm.spread_coincident(labels, step=0.012)
        shared = [(lbl["x"], lbl["y"]) for lbl in out if lbl["term"] != "solo"]
        assert len(set(shared)) == 4  # all distinct
        assert all(abs(x - 0.5) < 0.03 and abs(y - 0.5) < 0.03 for x, y in shared)  # still beside their evidence

    def test_lone_labels_are_untouched(self):
        out = bm.spread_coincident([{"term": "solo", "x": 0.1, "y": 0.9}], step=0.012)
        assert (out[0]["x"], out[0]["y"]) == (0.1, 0.9)

    def test_is_deterministic(self):
        def make():
            return [{"term": t, "x": 0.3, "y": 0.3} for t in "xyz"]

        assert bm.spread_coincident(make(), 0.012) == bm.spread_coincident(make(), 0.012)
