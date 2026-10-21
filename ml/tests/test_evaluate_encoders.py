"""Unit tests for the evaluation's metrics (no model download)."""

import numpy as np
import pytest

import evaluate_encoders as ev


def test_best_rank_is_the_first_answer_in_score_order():
    scores = np.array([0.1, 0.9, 0.5, 0.7])
    titles = ["a", "b", "c", "d"]
    assert ev.best_rank(scores, titles, ["c"]) == 3
    assert ev.best_rank(scores, titles, ["c", "d"]) == 2  # any listed answer counts


def test_recall_and_mrr():
    assert ev.recall_and_mrr([1, 2, 4], k=3) == (pytest.approx(2 / 3), pytest.approx((1 + 1 / 2 + 1 / 4) / 3))


def test_best_threshold_separates_answerable_from_unanswerable():
    threshold, accuracy = ev.best_threshold([0.5, 0.6, 0.7], [0.2, 0.3])
    assert accuracy == 1.0
    assert 0.3 < threshold <= 0.5


def test_best_threshold_reports_overlap():
    _, accuracy = ev.best_threshold([0.4, 0.8], [0.5])
    assert accuracy == pytest.approx(2 / 3)


def test_zero_shot_counts_passages_nearest_their_own_label():
    labels = np.eye(2)
    passages = np.array([[1.0, 0.1], [0.2, 1.0], [1.0, 0.0]])
    assert ev.zero_shot(passages, labels, [0, 1, 1]) == pytest.approx(2 / 3)
