"""
OCR service — extracts text from a medicine label image.

Primary: Gemini Vision (gemini-2.5-flash multimodal).
Fallback: Tesseract (local, if Gemini is unavailable or fails).
"""

import re
import logging
import mimetypes
from pathlib import Path

from app.config import GEMINI_API_KEY

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Optional Tesseract (fallback only)
try:
    import pytesseract
    from PIL import Image, ImageOps, ImageFilter
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False

# Gemini Vision setup
_gemini_client = None
if GEMINI_API_KEY:
    try:
        from google import genai
        _gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    except Exception:
        _gemini_client = None

_VISION_MODEL = "gemini-2.5-flash"

# Prompt sent to Gemini for medicine label OCR
_OCR_PROMPT = """\
You are a precise OCR engine specialised in medicine / pharmaceutical product labels.

Carefully read every piece of text visible in this image and transcribe it faithfully.

Rules:
- Preserve ALL words exactly as printed, including brand names, dosage, strength,
  indications, warnings, batch numbers, registration numbers and flavour.
- Reconstruct words that appear split across two lines (e.g. "VITA" on one line
  and "HERB" on the next should be output as "VITAHERB").
- Do NOT paraphrase, summarise, or add information not visible in the image.
- Output only the transcribed text, line by line, with no commentary.
"""


def _log_preview(text: str, limit: int = 400) -> str:
    preview = text.replace("\r", " ").replace("\n", " | ").strip()
    return preview[:limit] + ("…" if len(preview) > limit else "")


def _terminal_log(label: str, text: str) -> None:
    print(f"{label}: {text}", flush=True)


# Public entry point

def extract_text_from_image(image_path: str) -> dict:
    """
    Run OCR on an image file and return raw extracted text plus a cleaned version.

    Tries Gemini Vision first; falls back to Tesseract if needed.
    """
    path = Path(image_path)
    if not path.exists():
        return {
            "success": False,
            "error": f"Image file not found: {image_path}",
            "raw_text": "",
            "cleaned_text": "",
            "provider": None,
        }

    # Try Gemini Vision
    if _gemini_client:
        try:
            raw_text, provider = _extract_with_gemini(path), "gemini-vision"
            if raw_text and raw_text.strip():
                cleaned = _clean_ocr_text(raw_text, aggressive=False)
                _terminal_log("OCR provider", provider)
                _terminal_log("OCR raw text", _log_preview(raw_text))
                _terminal_log("OCR cleaned text", _log_preview(cleaned))
                logger.info("OCR provider: %s", provider)
                logger.info("OCR raw text: %s", _log_preview(raw_text))
                logger.info("OCR cleaned text: %s", _log_preview(cleaned))
                return {
                    "success": True,
                    "raw_text": raw_text,
                    "cleaned_text": cleaned,
                    "provider": provider,
                }
        except Exception as exc:
            logger.warning("Gemini Vision OCR failed (%s), falling back to Tesseract", exc)

    # Fallback: Tesseract
    if not TESSERACT_AVAILABLE:
        return {
            "success": False,
            "error": (
                "Gemini Vision is unavailable (check GEMINI_API_KEY) and "
                "pytesseract/Pillow are not installed."
            ),
            "raw_text": "",
            "cleaned_text": "",
            "provider": None,
        }

    try:
        provider = "tesseract"
        raw_text = _extract_with_tesseract(path)
        cleaned = _clean_ocr_text(raw_text, aggressive=True)
        _terminal_log("OCR provider", provider)
        _terminal_log("OCR raw text", _log_preview(raw_text))
        _terminal_log("OCR cleaned text", _log_preview(cleaned))
        logger.info("OCR provider: %s", provider)
        logger.info("OCR raw text: %s", _log_preview(raw_text))
        logger.info("OCR cleaned text: %s", _log_preview(cleaned))
        return {
            "success": True,
            "raw_text": raw_text,
            "cleaned_text": cleaned,
            "provider": provider,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "raw_text": "",
            "cleaned_text": "",
            "provider": None,
        }


# Gemini Vision OCR

def _extract_with_gemini(path: Path) -> str:
    """Send the image to Gemini Vision and return the transcribed text."""
    from google.genai import types

    # Detect MIME type (default to jpeg)
    mime_type, _ = mimetypes.guess_type(str(path))
    if not mime_type or not mime_type.startswith("image/"):
        mime_type = "image/jpeg"

    image_bytes = path.read_bytes()

    response = _gemini_client.models.generate_content(
        model=_VISION_MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            _OCR_PROMPT,
        ],
    )
    return (response.text or "").strip()


# Tesseract OCR (fallback)

def _extract_with_tesseract(path: Path) -> str:
    image = Image.open(path).convert("RGB")
    grey = image.convert("L")
    grey = ImageOps.autocontrast(grey, cutoff=2)
    grey = grey.filter(ImageFilter.SHARPEN)
    custom_config = r"--oem 3 --psm 11"
    return pytesseract.image_to_string(grey, config=custom_config)


# Text cleaners

def _clean_ocr_text(text: str, aggressive: bool = False) -> str:
    """Normalize OCR output."""
    if aggressive:
        # Remove non-printable / control characters (keep printable ASCII + newline)
        text = re.sub(r"[^\x20-\x7E\n]", " ", text)
        # Remove pipe characters used as fake separators by Tesseract
        text = re.sub(r"\|", " ", text)
        # Remove noise tokens like y=, %e, Vv
        text = re.sub(r"\b[a-zA-Z]{1,2}[=\-+%#@]{1,2}[a-zA-Z0-9]{0,2}\b", " ", text)
        # Remove isolated single non-alpha characters
        text = re.sub(r"(?<![\w])([^\w\s])(?![\w])", " ", text)
        # Drop lines that are only 1-2 characters (pure noise)
        lines = [ln for ln in text.splitlines() if len(ln.strip()) > 2]
        text = "\n".join(lines)

    # Common to both: collapse spaces/tabs and excess blank lines
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

