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

SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}
