from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from docuflow.constants import SUPPORTED_MIME_TYPES


def validate_document(
    filename: str,
    content_type: str,
    content: bytes,
    max_pages: int,
) -> int:
    extension = Path(filename).suffix.lower()
    expected_type = SUPPORTED_MIME_TYPES.get(extension)
    if not expected_type or content_type != expected_type:
        raise ValueError("Choose a PDF, PNG, or JPEG invoice with a matching file type.")

    if extension == ".pdf":
        if not content.startswith(b"%PDF-"):
            raise ValueError("This file is not a valid PDF.")
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content), strict=False)
            if reader.is_encrypted:
                raise ValueError("Password-protected PDFs are not supported.")
            page_count = len(reader.pages)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("This PDF could not be read. Try exporting it again.") from exc
    elif extension == ".png":
        if not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("This file is not a valid PNG image.")
        page_count = 1
    else:
        if not content.startswith(b"\xff\xd8\xff"):
            raise ValueError("This file is not a valid JPEG image.")
        page_count = 1

    if page_count < 1:
        raise ValueError("The invoice has no readable pages.")
    if page_count > max_pages:
        raise ValueError(f"Invoices can contain up to {max_pages} pages.")
    return page_count


def field_value(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("value", "")
    return "" if value is None else str(value)
