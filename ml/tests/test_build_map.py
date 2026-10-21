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
    "skills": [{"theme": "ml", "items": ["topic modelling", "Qdrant", "Rust", "Excel", "Docker"]}],
    "facts": ["Open to relocation."],
}


def collect(cv=CV):
    return bm.collect_passages(cv, THEMES)


def placed(passages, positions):
    """Give drawn passages fixed positions (and optionally themes), as build() would."""
    for p in passages:
        if p["theme"] is None:
            p.update(x=None, y=None)
        else:
            x, y, theme = positions.get(p["id"], (0.5, 0.5, p["theme"]))
            p.update(x=x, y=y, theme=theme)
    return passages


class TestCollectPassages:
    def test_ids_are_sequential_and_kinds_cover_cv(self):
        passages = collect()
        assert [p["id"] for p in passages] == list(range(len(passages)))
        kinds = [p["kind"] for p in passages]
        assert kinds.count("point") == 2
        assert kinds.count("tools") == 2
        assert kinds.count("education") == 2
        assert kinds.count("skills") == 1
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
        assert themes == {"Acme": 0, "RAG": 0, "Deploys": 1, "Acme toolkit": None, "Beta": 1, "Beta toolkit": None}

    def test_untagged_passages_are_not_drawn(self):
        untagged = {p["title"] for p in collect() if p["theme"] is None}
        assert untagged == {"BSc EE", "About", "Acme toolkit", "Beta toolkit"}  # tool lists stay searchable only

    def test_unknown_theme_fails_loudly(self):
        cv = {**CV, "skills": [{"theme": "nope", "items": []}]}
        with pytest.raises(ValueError, match="unknown theme 'nope'"):
            collect(cv)


class TestSkillLabels:
    def test_tool_placed_at_centre_of_passages_mentioning_it(self):
        passages = placed(collect(), {1: (0.2, 0.4, 1), 2: (0.8, 0.6, 2)})
        labels = {label["term"]: label for label in bm.skill_labels(CV, passages)}
        assert (labels["Qdrant"]["x"], labels["Qdrant"]["y"]) == (0.2, 0.4)

    def test_label_takes_the_theme_of_its_skills_list_not_its_evidence(self):
        # Qdrant's only evidence is an "llm" bullet, but it's listed under "ml".
        passages = placed(collect(), {})
        labels = {label["term"]: label for label in bm.skill_labels(CV, passages)}
        assert passages[labels["Qdrant"]["passages"][0]]["theme"] == 0
        assert labels["Qdrant"]["theme"] == 1

    def test_only_listed_skills_are_labelled(self):
        # "Go" is in a role's tech list but not in any skills list.
        labels = bm.skill_labels(CV, placed(collect(), {}))
        assert "Go" not in {label["term"] for label in labels}
        json.dumps(labels, allow_nan=False)

    def test_unmentioned_tool_falls_back_to_role_points(self):
        passages = placed(collect(), {1: (0.2, 0.2, 1), 2: (0.4, 0.4, 1)})
        labels = {label["term"]: label for label in bm.skill_labels(CV, passages)}
        assert labels["Rust"]["x"] == pytest.approx(0.3)

    def test_role_without_points_falls_back_to_its_context(self):
        passages = placed(collect(), {})
        labels = {label["term"]: label for label in bm.skill_labels(CV, passages)}
        assert [passages[i]["title"] for i in labels["Excel"]["passages"]] == ["Beta"]

    def test_declared_skill_falls_back_to_its_skills_group(self):
        passages = placed(collect(), {})
        group = next(p for p in passages if p["kind"] == "skills")
        group.update(x=0.9, y=0.1)
        labels = {label["term"]: label for label in bm.skill_labels(CV, passages)}
        assert labels["topic modelling"]["passages"] == [group["id"]]
        assert labels["topic modelling"]["theme"] == 1

    def test_list_passages_are_not_evidence_when_prose_exists(self):
        # "Qdrant" appears in a bullet, the role's tools list and the skills list;
        # only the bullet should count.
        passages = placed(collect(), {})
        hits = {label["term"]: label for label in bm.skill_labels(CV, passages)}["Qdrant"]["passages"]
        assert [passages[i]["kind"] for i in hits] == ["point"]

    def test_word_boundaries_prevent_partial_matches(self):
        cv = {
            **CV,
            "roles": [
                {
                    **CV["roles"][0],
                    "points": [{"title": "Tooling", "text": "Used Dockerfile tooling."}],
                    "tech": ["Docker"],
                }
            ],
        }
        passages = placed(collect(cv), {})
        hits = {label["term"]: label for label in bm.skill_labels(cv, passages)}["Docker"]["passages"]
        # Falls back to the role's points because "Dockerfile" is not "Docker".
        assert hits == [p["id"] for p in passages if p["kind"] == "point"]


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
