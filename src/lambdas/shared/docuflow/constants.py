from __future__ import annotations

STATUSES = {
    "CREATED",
    "UPLOADED",
    "PROCESSING",
    "COMPLETED",
    "NEEDS_REVIEW",
    "FAILED",
    "APPROVED",
    "REJECTED",
}

TERMINAL_STATUSES = {"COMPLETED", "FAILED", "APPROVED", "REJECTED"}

SUPPORTED_MIME_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
SUPPORTED_EXTENSIONS = set(SUPPORTED_MIME_TYPES)
