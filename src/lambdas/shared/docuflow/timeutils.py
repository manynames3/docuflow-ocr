from __future__ import annotations

from datetime import UTC, datetime, timedelta


def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def retention_expiry(days: int) -> int:
    return int((datetime.now(UTC) + timedelta(days=days)).timestamp())
