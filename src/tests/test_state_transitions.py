from __future__ import annotations

import pytest
from docuflow.confidence import status_for_review_decision


@pytest.mark.parametrize(
    ("decision", "status"),
    [
        ("approve", "APPROVED"),
        ("APPROVED", "APPROVED"),
        ("reject", "REJECTED"),
        ("REJECTED", "REJECTED"),
    ],
)
def test_review_decisions_map_to_terminal_statuses(decision: str, status: str) -> None:
    assert status_for_review_decision(decision) == status


def test_invalid_review_decision_is_rejected() -> None:
    with pytest.raises(ValueError, match="APPROVE or REJECT"):
        status_for_review_decision("maybe")
