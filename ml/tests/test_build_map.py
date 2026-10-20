"""Unit tests for the pure parts of build_map (no model download, no UMAP)."""

import base64
import json
from typing import ClassVar

import numpy as np
import pytest

import build_map as bm

CV = {
    "person": {"line": "I build AI.", "summary": "Five years."},
    "roles": [
        {
            "title": "AI Engineer",
            "org": "Acme",
            "context": "Builds agents.",
            "points": [
                {"title": "RAG", "text": "Built RAG with Qdrant."},
                {"title": "Deploys", "text": "Deployed with Docker."},
            ],
            "tech": ["Qdrant", "Docker", "Rust"],
        },
        {"title": "Analyst", "org": "Beta", "context": "Reports.", "points": [], "tech": ["Excel"]},
    ],
    "education": [{"degree": "MSc AI", "org": "Uni", "note": "Thesis on NLP."}, {"degree": "BSc EE", "org": "Uni"}],
    "skills": [{"group": "NLP", "items": ["topic modelling", "Qdrant"]}],
    "facts": ["Open to relocation."],
}


def placed(passages, positions):
    """Give map passages fixed positions and clusters, as build() would."""
    for p in passages:
        if p["kind"] in bm.OFF_MAP_KINDS:
            p.update(x=None, y=None, cluster=None, outlier=False)
        else:
            x, y, c = positions.get(p["id"], (0.5, 0.5, 0))
            p.update(x=x, y=y, cluster=c, outlier=False)
    return passages


class TestCollectPassages:
    def test_ids_are_sequential_and_kinds_cover_cv(self):
        passages = bm.collect_passages(CV)
        assert [p["id"] for p in passages] == list(range(len(passages)))
        kinds = [p["kind"] for p in passages]
        assert kinds.count("point") == 2
        assert kinds.count("tools") == 2
        assert kinds.count("education") == 2
        assert kinds.count("skills") == 1
        assert kinds.count("fact") == 1

    def test_every_passage_has_a_title(self):
        passages = bm.collect_passages(CV)
        titles = {p["kind"]: p["title"] for p in passages}
        assert [p["title"] for p in passages if p["kind"] == "point"] == ["RAG", "Deploys"]
        assert titles["context"] == "Beta"  # role context is titled by its org
        assert titles["tools"] == "Beta toolkit"
        assert titles["skills"] == "NLP"
        assert all(p["title"] for p in passages)

    def test_education_note_is_optional(self):
        texts = [p["text"] for p in bm.collect_passages(CV) if p["kind"] == "education"]
        assert texts == ["MSc AI, Uni. Thesis on NLP.", "BSc EE, Uni."]


class TestAttachNoise:
    def test_noise_joins_most_similar_cluster_by_cosine(self):
        # Cluster 0 is many tight points; cluster 1 is a single point. The noise
        # vector points almost exactly at cluster 1, so cosine must pick 1 even
        # though cluster 0 is larger.
        vectors = bm.normalise_rows(np.array([[1, 0], [1, 0.01], [1, -0.01], [0, 1], [0.05, 1]], dtype=np.float32))
        labels = np.array([0, 0, 0, 1, -1])
        out = bm.attach_noise(vectors, labels, labels >= 0)
        assert out.tolist() == [0, 0, 0, 1, 1]

    def test_does_not_mutate_input(self):
        vectors = bm.normalise_rows(np.eye(3, dtype=np.float32))
        labels = np.array([0, 1, -1])
        bm.attach_noise(vectors, labels, labels >= 0)
        assert labels.tolist() == [0, 1, -1]


class TestMatchNames:
    approved: ClassVar[list[bm.NamedCluster]] = [
        {"key": "agents", "name": "Agents", "summary": "a", "color": "#f00", "terms": ["agent", "tool", "model"]},
        {"key": "shipping", "name": "Shipping", "summary": "s", "color": "#0f0", "terms": ["docker", "aws", "deploy"]},
    ]

    def test_matches_by_overlap_regardless_of_cluster_ids(self):
        terms = {7: ["docker", "aws", "python"], 3: ["agent", "model", "prompt"]}
        names = bm.match_names(terms, self.approved, min_overlap=2)
        assert (names[7]["name"], names[7]["key"], names[7]["color"]) == ("Shipping", "shipping", "#0f0")
        assert names[3]["name"] == "Agents"
        assert all(n["approved"] for n in names.values())

    def test_each_name_is_used_once_best_overlap_wins(self):
        terms = {0: ["agent", "tool", "model"], 1: ["agent", "tool", "x"]}
        names = bm.match_names(terms, self.approved, min_overlap=2)
        assert names[0]["name"] == "Agents"
        assert names[1]["approved"] is False

    def test_low_overlap_gets_placeholder(self):
        names = bm.match_names({0: ["oracle", "linux", "sql"]}, self.approved, min_overlap=2)
        assert names[0] == {
            "key": "cluster-0",
            "name": "oracle, linux, sql",
            "summary": "",
            "color": bm.PLACEHOLDER_COLOR,
            "approved": False,
        }


class TestSkillLabels:
    def test_tool_placed_at_centre_of_passages_mentioning_it(self):
        passages = placed(bm.collect_passages(CV), {1: (0.2, 0.4, 1), 2: (0.8, 0.6, 2)})
        labels = {label["term"]: label for label in bm.skill_labels(CV, passages)}
        assert (labels["Qdrant"]["x"], labels["Qdrant"]["y"], labels["Qdrant"]["cluster"]) == (0.2, 0.4, 1)

    def test_unmentioned_tool_falls_back_to_role_points(self):
        passages = placed(bm.collect_passages(CV), {1: (0.2, 0.2, 1), 2: (0.4, 0.4, 1)})
        labels = {label["term"]: label for label in bm.skill_labels(CV, passages)}
        assert labels["Rust"]["x"] == pytest.approx(0.3)

    def test_tool_with_no_evidence_is_skipped_not_nan(self):
        # "Excel" is never mentioned and its role has no bullet points.
        passages = placed(bm.collect_passages(CV), {})
        labels = bm.skill_labels(CV, passages)
        assert "Excel" not in {label["term"] for label in labels}
        json.dumps(labels, allow_nan=False)

    def test_declared_skill_falls_back_to_its_skills_group(self):
        passages = placed(bm.collect_passages(CV), {})
        group = next(p for p in passages if p["kind"] == "skills")
        group.update(x=0.9, y=0.1, cluster=3)
        labels = {label["term"]: label for label in bm.skill_labels(CV, passages)}
        assert labels["topic modelling"]["passages"] == [group["id"]]
        assert labels["topic modelling"]["cluster"] == 3

    def test_list_passages_are_not_evidence_when_prose_exists(self):
        # "Qdrant" appears in a bullet, the role's tools list and the skills list;
        # only the bullet should count.
        passages = placed(bm.collect_passages(CV), {})
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
        passages = placed(bm.collect_passages(cv), {})
        hits = bm.skill_labels(cv, passages)[0]["passages"]
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
