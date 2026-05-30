"""
PDF text extraction utility.

Uses pypdf (pure-Python, no system dependencies).
Falls back gracefully on encrypted / image-only PDFs.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Union

import pypdf


MAX_CHARS = 12_000   # keep prompts reasonable


def extract_text(source: Union[bytes, str, Path]) -> str:
    """
    Extract plain text from a PDF.

    source — raw bytes, a file path, or a Path object.
    Returns extracted text (up to MAX_CHARS) or an empty string on failure.
    """
    try:
        if isinstance(source, (str, Path)):
            reader = pypdf.PdfReader(str(source))
        else:
            reader = pypdf.PdfReader(io.BytesIO(source))

        pages: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            pages.append(text.strip())

        full = "\n\n".join(p for p in pages if p)
        return full[:MAX_CHARS]

    except Exception:
        return ""
