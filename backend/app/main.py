"""
UbatLah Backend — FastAPI application.

Routes
------
POST /ocr                  Upload a medicine label image → OCR text
POST /verify-npra          LLM-clean OCR text → exact NPRA product record
POST /openfda              Fetch drug label from openFDA by active ingredient
POST /upload-patient-case  Parse + index patient PDF into ChromaDB
POST /analyze              Generate AI safety summary (NPRA + openFDA + RAG)
POST /chat                 Answer a follow-up question using context
GET  /session              Inspect current in-memory session state
GET  /patient-status       Check if a patient PDF has been indexed
GET  /health               Health check
"""

import os
import shutil
import logging
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.config import UPLOAD_DIR
from app.services.ocr_service import extract_text_from_image
from app.services.npra_service import search_npra_product
from app.services.openfda_service import clean_ingredient, search_openfda_label
from app.services.pdf_rag_service import (
    get_collection_status,
    index_patient_pdf,
    retrieve_patient_context,
    clear_patient_data,
)
from app.services.llm_service import (
    answer_chat,
    extract_label_details,
    extract_medicine_name,
    generate_safety_summary,
    verify_label_online,
)

from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler
from app.services.npra_sync_service import run_pipeline

# ---------------------------------------------------------------------------
# Initialisation
# ---------------------------------------------------------------------------
os.makedirs(UPLOAD_DIR, exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize APScheduler (Option B for NPRA Sync)
    scheduler = BackgroundScheduler()
    # Schedule the sync pipeline to run every day at 2:00 AM
    scheduler.add_job(run_pipeline, 'cron', hour=2, minute=0)
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(
    title="UbatLah API",
    description=(
        "Context-aware medication safety assistant. "
        "Combines NPRA verification, OpenFDA drug label data, "
        "and patient-case RAG to generate personalised safety summaries."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory session — holds the context for the current medicine being analysed.
# For a production system replace with a Redis-backed session store.
# ---------------------------------------------------------------------------
_session: dict = {
    "ocr_text":       None,   # raw OCR output
    "ocr_cleaned":    None,   # cleaned OCR text used for NPRA lookup
    "npra_info":      None,   # dict returned by search_npra_product()
    "drug_label_info": None,  # dict returned by search_openfda_label()
}

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _log_preview(text: str | None, limit: int = 400) -> str:
    if not text:
        return ""
    preview = text.replace("\r", " ").replace("\n", " | ").strip()
    return preview[:limit] + ("…" if len(preview) > limit else "")


def _terminal_log(label: str, text: str) -> None:
    print(f"{label}: {text}", flush=True)


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _save_upload(upload: UploadFile) -> str:
    """Save an uploaded file to UPLOAD_DIR and return its path."""
    dest = Path(UPLOAD_DIR) / upload.filename
    with dest.open("wb") as buf:
        shutil.copyfileobj(upload.file, buf)
    return str(dest)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health", tags=["Utility"])
def health():
    return {"status": "ok", "service": "UbatLah API"}


@app.get("/session", tags=["Utility"])
def get_session():
    """Return what is currently stored in the server session (for debugging)."""
    return {
        "ocr_text":        _session["ocr_text"],
        "ocr_cleaned":     _session["ocr_cleaned"],
        "npra_found":      _session["npra_info"] is not None,
        "openfda_fetched": _session["drug_label_info"] is not None,
        "label_verification": _session.get("label_verification"),
    }


@app.get("/patient-status", tags=["Patient PDF"])
def patient_status():
    """Check whether a patient PDF has been indexed into ChromaDB."""
    return get_collection_status()


# ------------------------------------------------------------------
# Step 1 — OCR
# ------------------------------------------------------------------

@app.post("/ocr", tags=["Medicine Label"])
async def ocr_image(file: UploadFile = File(...)):
    """
    Upload a medicine label image.
    Returns the raw OCR text and a cleaned version ready for NPRA lookup.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=f"Expected an image file, got: {file.content_type}"
        )

    file_path = _save_upload(file)
    result = extract_text_from_image(file_path)

    if not result["success"]:
        raise HTTPException(status_code=422, detail=result.get("error", "OCR failed"))

    logger.info("OCR raw text: %s", _log_preview(result["raw_text"]))
    logger.info("OCR cleaned text: %s", _log_preview(result["cleaned_text"]))
    _terminal_log("OCR raw text", _log_preview(result["raw_text"]))
    _terminal_log("OCR cleaned text", _log_preview(result["cleaned_text"]))

    # Persist to session so the frontend can immediately call /verify-npra
    _session["ocr_text"] = result["raw_text"]
    _session["ocr_cleaned"] = result["cleaned_text"]

    return {
        "success": True,
        "raw_text": result["raw_text"],
        "cleaned_text": result["cleaned_text"],
        "provider": result.get("provider"),
    }


# ------------------------------------------------------------------
# Step 2 — NPRA Verification
# ------------------------------------------------------------------

@app.post("/verify-npra", tags=["Medicine Label"])
def verify_npra(ocr_text: str = Form(...), raw_ocr_text: str | None = Form(None)):
    """
    Use the LLM to clean OCR noise, then do a direct normalized NPRA lookup.

    `ocr_text` is accepted as a form field so the frontend can pass either
    the raw OCR output or a manually edited name.
    """
    if not ocr_text.strip():
        raise HTTPException(status_code=400, detail="ocr_text must not be empty.")

    raw_query = ocr_text.strip()
    source_text = (raw_ocr_text or raw_query).strip()
    label_details = extract_label_details(source_text)

    # Run an optional online verification step (LLM + web snippets) using the raw OCR
    verification = verify_label_online(source_text)

    # Prefer a web-verified medicine name when available
    verified_name = verification.get("medicine_name") if isinstance(verification, dict) else None
    cleaned_query = (verified_name or label_details.get("medicine_name") or extract_medicine_name(raw_query) or raw_query)
    normalized_query = cleaned_query.strip()
    logger.info(
        "NPRA verify trace: raw=%s | source=%s | llm=%s | normalized=%s | manufacturer=%s | company=%s",
        _log_preview(raw_query),
        _log_preview(source_text),
        _log_preview(cleaned_query),
        _log_preview(normalized_query),
        _log_preview(label_details.get("manufacturer")),
        _log_preview(label_details.get("company")),
    )
    _terminal_log(
        "NPRA verify trace",
        f"raw={_log_preview(raw_query)} | source={_log_preview(source_text)} | llm={_log_preview(cleaned_query)} | normalized={_log_preview(normalized_query)} | manufacturer={_log_preview(label_details.get('manufacturer'))} | company={_log_preview(label_details.get('company'))}",
    )
    npra_info = search_npra_product(
        normalized_query,
        source_text=source_text,
        detected_manufacturer=label_details.get("manufacturer"),
        detected_company=label_details.get("company"),
    )

    # store verification result in session for UI and downstream analysis
    _session["label_verification"] = verification

    if not npra_info or "rejected_reason" in npra_info:
        # Clear stale session data
        _session["npra_info"] = None
        message = npra_info["rejected_reason"] if npra_info else (
            "No matching product found in the NPRA database. "
            "The product may be unregistered or the label text may need correction."
        )
        logger.info("NPRA match: no result or rejected")
        return {
            "found": False,
            "normalized_query": normalized_query,
            "message": message,
            "verification": verification,
        }

    _session["ocr_text"] = normalized_query
    _session["npra_info"] = npra_info

    logger.info(
        "NPRA match: %s (%s) score=%s status=%s",
        npra_info.get("product"),
        npra_info.get("registration_no"),
        npra_info.get("match_score"),
        npra_info.get("status"),
    )

    return {
        "found": True,
        "normalized_query": normalized_query,
        "npra_info": npra_info,
        "verification": verification,
    }


# ------------------------------------------------------------------
# Step 3 — OpenFDA Drug Label
# ------------------------------------------------------------------

@app.post("/openfda", tags=["Drug Label"])
def get_openfda_info(active_ingredient: str = Form(None)):
    """
    Retrieve the drug label from openFDA.

    If `active_ingredient` is provided in the form body it is used directly.
    Otherwise the active ingredient is taken from the current NPRA session.
    """
    ingredient = active_ingredient

    if not ingredient:
        npra_info = _session.get("npra_info")
        if not npra_info:
            raise HTTPException(
                status_code=400,
                detail="No NPRA data in session. Run /verify-npra first, or supply active_ingredient."
            )
        ingredient = npra_info.get("active_ingredient")

    cleaned = clean_ingredient(ingredient)

    if not cleaned:
        raise HTTPException(
            status_code=422,
            detail=f"Could not parse a usable ingredient name from: {ingredient!r}"
        )

    drug_label_info = search_openfda_label(cleaned)

    if not drug_label_info:
        return {
            "success": False,
            "active_ingredient_queried": cleaned,
            "message": "No drug label found in openFDA for this ingredient.",
            "drug_label_info": None,
        }

    _session["drug_label_info"] = drug_label_info

    return {
        "success": True,
        "active_ingredient_queried": cleaned,
        "drug_label_info": drug_label_info,
    }


# ------------------------------------------------------------------
# Step 4 — Upload Patient PDF
# ------------------------------------------------------------------

@app.post("/upload-patient-case", tags=["Patient PDF"])
async def upload_patient_case(file: UploadFile = File(...)):
    """
    Upload a patient case PDF.
    Text is extracted, chunked, embedded, and stored in ChromaDB.
    """
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(
            status_code=400,
            detail=f"Expected a PDF file, got: {file.content_type}"
        )

    file_path = _save_upload(file)
    result = index_patient_pdf(file_path)

    if not result.get("success"):
        raise HTTPException(status_code=422, detail=result.get("message", "PDF indexing failed."))

    return result


@app.delete("/patient-case", tags=["Patient PDF"])
def delete_patient_case():
    """
    Clear the current patient case from the database.
    """
    result = clear_patient_data()
    return result


# ------------------------------------------------------------------
# Step 5 — AI Safety Analysis
# ------------------------------------------------------------------

@app.post("/analyze", tags=["AI Analysis"])
def analyze():
    """
    Generate an AI-powered medication safety summary.

    Combines:
    - NPRA product verification (from session)
    - OpenFDA drug label information (from session)
    - Patient context retrieved from ChromaDB via RAG
    """
    npra_info = _session.get("npra_info")
    drug_label_info = _session.get("drug_label_info")

    if npra_info and not drug_label_info:
        ingredient = npra_info.get("active_ingredient")
        cleaned = clean_ingredient(ingredient)
        if cleaned:
          drug_label_info = search_openfda_label(cleaned)
          if drug_label_info:
              _session["drug_label_info"] = drug_label_info

    if not npra_info and not drug_label_info:
        raise HTTPException(
            status_code=400,
            detail="No medicine data in session. Run /verify-npra and /openfda first."
        )

    # Broad query to capture the most patient-safety-relevant chunks
    rag_query = (
        "patient allergies current medication medical history "
        "disease condition age pregnancy safety concern"
    )
    patient_context = retrieve_patient_context(rag_query, n_results=4)

    summary = generate_safety_summary(
        npra_info=npra_info,
        drug_label_info=drug_label_info,
        patient_context=patient_context,
    )

    return {
        "success": True,
        "summary": summary,
        "patient_context_retrieved": patient_context,
    }


# ------------------------------------------------------------------
# Step 6 — Chatbot
# ------------------------------------------------------------------

@app.post("/chat", tags=["AI Analysis"])
def chat(question: str = Form(...)):
    """
    Answer a follow-up question about the medicine or the patient's situation.

    Context is retrieved from ChromaDB (patient PDF RAG) for the specific question,
    then combined with session NPRA + openFDA data before calling the LLM.
    """
    if not question.strip():
        raise HTTPException(status_code=400, detail="question must not be empty.")

    npra_info = _session.get("npra_info")
    drug_label_info = _session.get("drug_label_info")

    # Enrich the query for better vector retrieval (RAG)
    drug_name = npra_info.get("product", "") if npra_info else ""
    enriched_query = f"{question} {drug_name} patient medical history conditions allergies"

    patient_context = retrieve_patient_context(enriched_query, n_results=3)

    answer = answer_chat(
        question=question,
        npra_info=npra_info,
        drug_label_info=drug_label_info,
        patient_context=patient_context,
    )

    return {
        "success": True,
        "question": question,
        "answer": answer,
        "patient_context_retrieved": patient_context,
    }