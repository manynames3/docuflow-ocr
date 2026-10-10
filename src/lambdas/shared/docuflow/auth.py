from __future__ import annotations

from typing import Any


def claims(event: dict[str, Any]) -> dict[str, Any]:
    request_context = event.get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}
    jwt = authorizer.get("jwt") or {}
    return jwt.get("claims") or {}


def subject(event: dict[str, Any]) -> str:
    value = claims(event).get("sub")
    if not isinstance(value, str) or not value:
        raise PermissionError("authentication is required")
    return value
