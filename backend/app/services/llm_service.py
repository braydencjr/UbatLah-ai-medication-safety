"""
LLM service — uses Google Gemini to generate:
  1. A concise, plain-English safety summary.
  2. Short, friendly answers to chatbot questions.
"""

import json
import os
import requests

from google import genai
from app.config import GEMINI_API_KEY

_client = genai.Client(api_key=GEMINI_API_KEY)
_MODEL = "gemini-2.5-flash"


_PERSONA = """
You are an expert, highly intelligent clinical pharmacist and medication safety AI.

Rules:
- Be friendly, clear, and informative. Use natural language that is easy to understand, but retain your expert pharmaceutical knowledge.
- ALWAYS structure your responses cleanly using Markdown (use ### headings, bolding, and bullet points) to make it readable.
- Be concise. Do NOT write long, lengthy paragraphs. Provide the core facts directly.
- If specific data (like side effects, dosage, or interactions) is missing from the provided text, DO NOT say "information is not available". Instead, use your expert general pharmacological knowledge based on the known active ingredients or standard medicine class to provide an accurate, helpful answer.
- Do not blindly repeat robotic boilerplate like "always talk to your doctor" as your entire answer. If there is a risk, explain the *biochemical or clinical reason why* (e.g., "Ingredient X is metabolized by the liver and interacts with Warfarin, increasing bleeding risk") and flag it with ⚠.
- Do NOT diagnose or prescribe.
""".strip()


def extract_medicine_name(ocr_text: str) -> str | None:
    """Extract the shortest useful medicine or product name from OCR text."""

    details = extract_label_details(ocr_text)
    return details.get("medicine_name") or None


def extract_label_details(ocr_text: str) -> dict[str, str | None]:
    """Extract the likely medicine name, manufacturer, and company from raw OCR text."""

    cleaned = ocr_text.strip() if ocr_text else ""
    if not cleaned:
        return {"medicine_name": None, "manufacturer": None, "company": None}

    prompt = f"""{_PERSONA}

Analyze this raw OCR text scanned from a physical medicine label.
The text may contain noise (extra characters, broken words, pipe symbols, garbled letters).

Return JSON only — no extra text — with exactly these keys:
- "medicine_name": The product name (e.g. "Vitaherb Ivy Leaf Syrup"). Include brand + active ingredient + form when visible.
- "manufacturer": The manufacturing company name, or null.
- "company": The brand owner / marketing company name, or null.

Important extraction rules:
1. ALL-CAPS words (e.g. VITAHERB, PANADOL, CLARITYN) are almost always a brand or company name.
2. Words immediately before or after ® © ™ ' are brand/company names.
3. "medicine_name" should combine the brand with the active ingredient and dosage form when visible.
4. If manufacturer and company appear to be the same entity, repeat the value in both fields.
5. Ignore single letters, numbers alone, pipe characters, and obvious noise tokens.
6. If a field truly cannot be determined, use null.

OCR text:
{cleaned}
"""

    try:
        response = _client.models.generate_content(model=_MODEL, contents=prompt)
    except Exception:
        return {"medicine_name": None, "manufacturer": None, "company": None}

    candidate = (response.text or "").strip()
    if not candidate:
        return {"medicine_name": None, "manufacturer": None, "company": None}

    parsed = _parse_json_response(candidate)
    if not parsed:
        fallback_name = _extract_name_from_text(candidate)
        return {"medicine_name": fallback_name, "manufacturer": None, "company": None}

    result = {
        "medicine_name": _clean_text_value(parsed.get("medicine_name")),
        "manufacturer": _clean_text_value(parsed.get("manufacturer")),
        "company": _clean_text_value(parsed.get("company")),
    }

    # --- Regex fallback: if LLM missed brand/company, scan for ALL-CAPS brand tokens ---
    if not result["company"] and not result["manufacturer"]:
        brand = _extract_brand_from_ocr(cleaned)
        if brand:
            result["company"] = brand
            result["manufacturer"] = brand

    return result


def _extract_brand_from_ocr(text: str) -> str | None:
    """
    Fallback: find ALL-CAPS words (4+ letters) near trademark symbols.
    These are almost always brand names on medicine labels.
    """
    import re as _re
    # Match ALL-CAPS words ≥4 chars, optionally followed by ® ™ '
    matches = _re_brand.findall(text)
    # Filter common false positives
    _stop = {"SYRUP", "TABLET", "CAPSULE", "ORAL", "SOLUTION", "INJECTION", "CREAM", "GEL", "DROP"}
    candidates = [m.strip("'®™ ") for m in matches if m.strip("'®™ ").upper() not in _stop]
    return candidates[0] if candidates else None


import re as _re_module
_re_brand = _re_module.compile(r"\b[A-Z]{4,}[®™']?\b")


def verify_label_online(raw_ocr_text: str) -> dict:
    """
    Try to verify label details by (optional) web search then LLM consolidation.

    Behavior:
    - If `SERPAPI_API_KEY` env var is present, perform simple SerpAPI web searches
      for the product name and company/manufacturer and include top snippets.
    - Call the LLM with the raw OCR text plus collected snippets and ask it to
      return a JSON object containing: medicine_name, manufacturer, company,
      sources (list), verdict, confidence (0-100), and notes.

    If no search API key is configured, the LLM will be asked to infer
    likely values from the OCR text only and will mark `web_checked: false`.
    """
    if not raw_ocr_text:
        return {"web_checked": False, "medicine_name": None, "manufacturer": None, "company": None, "sources": [], "verdict": "no_input", "confidence": 0, "notes": "No OCR text provided."}

    api_key = os.environ.get("SERPAPI_API_KEY")
    snippets = []
    queries = []

    details = extract_label_details(raw_ocr_text)
    candidate_name = details.get("medicine_name") or ""
    candidate_company = details.get("company") or details.get("manufacturer") or ""

    if candidate_name:
        queries.append(candidate_name)
    # add a general query using the first line of OCR as fallback
    first_line = raw_ocr_text.strip().splitlines()[0][:200]
    if first_line and first_line not in queries:
        queries.append(first_line)
    if candidate_company:
        queries.append(candidate_company)

    if api_key:
        for q in queries[:3]:
            try:
                resp = requests.get(
                    "https://serpapi.com/search.json",
                    params={"q": q, "api_key": api_key, "num": 3},
                    timeout=8,
                )
                resp.raise_for_status()
                j = resp.json()
                results = j.get("organic_results") or j.get("organic") or []
                for r in results[:3]:
                    snippets.append({
                        "query": q,
                        "title": r.get("title") or r.get("snippet", ""),
                        "link": r.get("link") or r.get("url"),
                        "snippet": r.get("snippet") or r.get("snippet_text") or "",
                    })
            except Exception:
                # ignore search errors and continue
                continue

    # Build prompt for LLM consolidation
    web_block = "\n\n".join([f"Query: {s['query']}\nTitle: {s.get('title')}\nURL: {s.get('link')}\nSnippet: {s.get('snippet')}" for s in snippets])

    if api_key and snippets:
        web_note = "Web snippets from SerpAPI provided below."
    else:
        web_note = "No web snippets available; the model must infer from OCR only."

    prompt = f"""{_PERSONA}

You are given raw OCR text from a medicine label and (optionally) web search snippets.

Task: Consolidate the evidence and return JSON only with these keys:
- medicine_name (shortest useful name or null)
- manufacturer (short or null)
- company (short or null)
- web_checked (true/false)
- sources (array of {{title, url, snippet}})
- verdict (one of: verified, probable, not_found, ambiguous)
- confidence (0-100 integer)
- notes (short string)

Rules:
- Use only the OCR text and the provided web snippets. If no snippets, be explicit that web_check was not performed.
- If the web snippets clearly match the product and company, set verdict to 'verified'.
- If snippets partially match, use 'probable'. If none match, 'not_found'.
- Keep values short. Return valid JSON only.

OCR text:
{raw_ocr_text}

{web_note}

Web snippets:
{web_block}
"""

    try:
        response = _client.models.generate_content(model=_MODEL, contents=prompt)
        candidate = (response.text or "").strip()
        parsed = _parse_json_response(candidate)
        if parsed:
            return parsed
        # If LLM didn't output JSON, return a conservative fallback
        return {"web_checked": bool(snippets), "medicine_name": details.get("medicine_name"), "manufacturer": details.get("manufacturer"), "company": details.get("company"), "sources": snippets, "verdict": "ambiguous", "confidence": 40, "notes": "LLM did not return JSON; fallback used."}
    except Exception:
        return {"web_checked": bool(snippets), "medicine_name": details.get("medicine_name"), "manufacturer": details.get("manufacturer"), "company": details.get("company"), "sources": snippets, "verdict": "error", "confidence": 0, "notes": "LLM call failed."}



# Public API
def generate_safety_summary(
    npra_info: dict | None,
    drug_label_info: dict | None,
    patient_context: str,
) -> str:
    """Very short, scannable safety overview — plain English, no jargon."""

    npra_block = _format_npra(npra_info)
    drug_block = _format_drug_label(drug_label_info)
    patient_block = patient_context.strip() if patient_context else "No patient case was uploaded. Give general advice only."

    prompt = f"""{_PERSONA}

---
Medicine info (from database):
{npra_block}

Drug label info:
{drug_block}

Patient information:
{patient_block}

---
Write a VERY SHORT safety overview using the information above. 
If specific standard usage or dosage instructions are not in the context, do NOT say "I don't have instructions" or "I don't know". Use your general knowledge to provide a safe, standard guideline for taking this medicine, and remind the user to also read the product packaging.
Keep it to 120 to 180 words total.
Use this exact structure and keep each section brief:

### What this medicine does
- 1 short bullet only

### How to take it
- 1 short bullet only

### Watch out for
- 2 short bullets maximum

### Specific concerns for this patient
- If patient context exists, list each patient-specific concern as a separate bullet point.
- Keep each bullet point brief and clear.
- If no patient info is available, say: "No patient case was uploaded."

### Questions to ask your doctor or pharmacist
- 1 to 2 short questions only

Do not add extra sections, introductions, or disclaimers.
Write as if talking to a patient, not a doctor.
"""

    response = _client.models.generate_content(model=_MODEL, contents=prompt)
    return response.text


def answer_chat(
    question: str,
    npra_info: dict | None,
    drug_label_info: dict | None,
    patient_context: str,
) -> str:
    """Answer a question in plain English, short and friendly."""

    npra_block = _format_npra(npra_info)
    drug_block = _format_drug_label(drug_label_info)
    patient_block = patient_context.strip() if patient_context else "No patient case was uploaded. Give general advice only."

    prompt = f"""{_PERSONA}

---
Medicine info:
{npra_block}

Drug label info:
{drug_block}

Patient information:
{patient_block}

---
Question: {question}

Provide an intelligent, expert-level pharmaceutical answer.
CRITICAL RULES FOR BREVITY:
1. NEVER write paragraphs. 
2. MAXIMUM 2 short bullet points total. 
3. Under absolutely no circumstances should your response exceed 40 words.
ALWAYS format your output with Markdown (e.g., ### Headings, bullet points).
Use the available context (NPRA, OpenFDA, Patient context). If specific details are missing, seamlessly use your general pharmacological knowledge. Do NOT apologize for missing data.
If patient context exists, state the interaction clearly (e.g., "⚠ **Liver & Warfarin Risk:** Herb X reduces Warfarin efficacy and strains liver enzymes.")
Do not repeat the question.
"""

    response = _client.models.generate_content(model=_MODEL, contents=prompt)
    return response.text



# Formatters
def _format_npra(npra_info: dict | None) -> str:
    if not npra_info:
        return "No medicine database record available."
    lines = []
    for key, label in [
        ("product", "Product"), ("status", "Status"), ("manufacturer", "Manufacturer"),
        ("holder", "Registered holder"),
        ("active_ingredient", "Active ingredient"), ("generic_name", "Generic name"),
        ("description", "Registered indication / description"),
        ("match_score", "Match confidence"),
    ]:
        val = npra_info.get(key)
        if val is not None:
            lines.append(f"- {label}: {val}")
    return "\n".join(lines) or "No details."



def _format_drug_label(drug_label_info: dict | None) -> str:
    if not drug_label_info:
        return "No drug label information available."

    label_map = {
        "openfda_brand_name":         "Brand name",
        "openfda_generic_name":       "Generic name",
        "purpose":                    "Purpose",
        "indications_and_usage":      "Uses",
        "dosage_and_administration":  "Dosage",
        "warnings":                   "Warnings",
        "warnings_and_cautions":      "Warnings",
        "precautions":                "Precautions",
        "contraindications":          "Do not use if",
        "adverse_reactions":          "Side effects",
        "drug_interactions":          "Drug interactions",
    }

    lines = []
    for key, label in label_map.items():
        val = drug_label_info.get(key)
        if val:
            snippet = val[:280] + "…" if len(val) > 280 else val
            lines.append(f"**{label}**: {snippet}")

    return "\n\n".join(lines) or "No details."


def _parse_json_response(text: str) -> dict | None:
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.split("\n", 1)[-1].strip() if "\n" in raw else raw

    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        pass

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(raw[start : end + 1])
            return data if isinstance(data, dict) else None
        except Exception:
            return None
    return None


def _clean_text_value(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip().replace("`", "")
    return text or None


def _extract_name_from_text(text: str) -> str | None:
    candidate = text.replace("`", "").strip()
    if not candidate:
        return None
    candidate = candidate.splitlines()[0].strip()
    for prefix in ("Medicine:", "Product:", "Name:"):
        if candidate.lower().startswith(prefix.lower()):
            candidate = candidate[len(prefix):].strip()
    return candidate or None