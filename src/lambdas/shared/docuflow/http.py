from __future__ import annotations

import json
from typing import Any


def json_response(status_code: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "content-type": "application/json",
            "cache-control": "no-store",
        },
        "body": json.dumps(body, default=str),
    }


def text_response(status_code: int, body: str, content_type: str) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"content-type": content_type, "cache-control": "no-store"},
        "body": body,
    }


def parse_json_body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body")
    if not body:
        return {}
    if event.get("isBase64Encoded"):
        raise ValueError("base64 encoded request bodies are not supported")
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("request body must be a JSON object")
    return parsed


def path_param(event: dict[str, Any], name: str) -> str | None:
    return (event.get("pathParameters") or {}).get(name)


def route_key(event: dict[str, Any]) -> str:
    return event.get("routeKey") or f"{event.get('httpMethod', '')} {event.get('resource', '')}"


def request_header(event: dict[str, Any], name: str) -> str | None:
    headers = event.get("headers") or {}
    target = name.lower()
    return next((value for key, value in headers.items() if key.lower() == target), None)
