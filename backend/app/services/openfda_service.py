"""
OpenFDA drug label service.

Retrieves structured drug label information from the FDA openFDA API
(https://api.fda.gov/drug/label.json) using the medicine's active ingredient.
"""

import re
import requests

# Seconds to wait for the openFDA API before giving up
_REQUEST_TIMEOUT = 10

# Fields we want from the drug label record
_USEFUL_FIELDS = [
    "purpose",
    "indications_and_usage",
    "dosage_and_administration",
    "warnings",
    "warnings_and_cautions",
    "precautions",
    "contraindications",
    "adverse_reactions",
    "drug_interactions",
    "keep_out_of_reach_of_children",
    "storage_and_handling",
]


def clean_ingredient(raw: str | None) -> str | None:
    """
    Normalise the raw active_ingredient string from the NPRA CSV into a
    plain ingredient name suitable for an openFDA query.

    Examples:
      "Paracetamol[500;mg;1;tablet]"    → "Paracetamol"
      "Paracetamol[500MG], Caffeine[65MG]" → "Paracetamol"  (first ingredient)
    """
    if not raw:
        return None

    # Take only the first ingredient (before any comma)
    first = raw.split(",")[0].strip()

    # Remove everything inside square brackets  e.g. [500;mg;...]
    name = re.sub(r"\[.*?\]", "", first)

    # Remove leftover punctuation / digits / whitespace
    name = re.sub(r"[^A-Za-z\s\-]", "", name).strip()

    return name if name else None


def search_openfda_label(active_ingredient: str | None) -> dict | None:
    """
    Query the openFDA drug label API for the given `active_ingredient`.

    Returns a dict of extracted label fields, or None on failure / no results.

    Strategy:
      1. Try a search on `openfda.generic_name` (most precise).
      2. Fall back to a full-text search on `active_ingredient` field.
      3. Reject results that are clearly for a different drug category (e.g. sunscreen
         returned for a cough/herbal ingredient).
    """
    if not active_ingredient:
        return None

    ingredient = active_ingredient.strip()

    label_data = _fetch_label(field="openfda.generic_name", value=ingredient)

    if not label_data:
        label_data = _fetch_label(field="active_ingredient", value=ingredient)

    if not label_data:
        return None

    # --- Relevance gate ---
    # Reject results that are obviously for a different drug category.
    if not _is_relevant_result(label_data, ingredient):
        return None

    return _extract_fields(label_data)


# ---------------------------------------------------------------------------
# Relevance validation
# ---------------------------------------------------------------------------

# Keywords that indicate a result is almost certainly NOT a systemic/oral drug
_IRRELEVANT_PURPOSES = re.compile(
    r"\b(sunscreen|sun\s*protect|spf|skin\s*protectant|insect\s*repellent|"
    r"antiperspirant|deodorant|cosmetic|teeth\s*whiten|breath\s*freshen|"
    r"ophthalm|conjunctiv|corneal\s*ulcer|otic|ear\s*drop|eye\s*drop|"
    r"bacterial\s*conjunctiv|ocular\s*infect)\b",
    re.IGNORECASE,
)

# Product types that are clearly non-drug
_IRRELEVANT_TYPES = re.compile(
    r"\b(cosmetic|dietary\s*supplement|device)\b",
    re.IGNORECASE,
)


def _is_relevant_result(result: dict, queried_ingredient: str) -> bool:
    """
    Return True when the openFDA result appears relevant to the queried ingredient.

    Checks performed (any failure → reject):
    1. Purpose/indications must not contain unrelated-category keywords (sunscreen, eye drops…).
    2. Product type must not be cosmetic/device/supplement.
    3. The returned label's active_ingredient text must share at least one meaningful
       word with the queried ingredient — this catches cases where openFDA returns a
       completely different drug (e.g. Ofloxacin when we searched for Hedera helix).
    """
    # Build a combined text blob from the most diagnostic fields
    diagnostic_fields = ["purpose", "indications_and_usage", "active_ingredient"]
    blob = " ".join(
        " ".join(result[f]) if isinstance(result.get(f), list) else (result.get(f) or "")
        for f in diagnostic_fields
    )

    openfda = result.get("openfda", {})
    product_type = " ".join(openfda.get("product_type") or [])

    if _IRRELEVANT_PURPOSES.search(blob):
        return False
    if _IRRELEVANT_TYPES.search(product_type):
        return False

    # --- Ingredient word-overlap check ---
    # Extract the active_ingredient text from the result
    ai_raw = result.get("active_ingredient", [])
    if isinstance(ai_raw, list):
        ai_text = " ".join(ai_raw).lower()
    else:
        ai_text = str(ai_raw).lower()

    # Also check the openfda generic_name list
    generic_names = " ".join(openfda.get("generic_name") or []).lower()
    ai_text = ai_text + " " + generic_names

    # Meaningful words from the queried ingredient (≥4 chars, ignore common filler)
    _filler = {"extract", "dried", "leaf", "leaves", "root", "powder", "herb"}
    queried_words = [
        w for w in re.split(r"[^a-z]+", queried_ingredient.lower())
        if len(w) >= 4 and w not in _filler
    ]

    if queried_words and not any(w in ai_text for w in queried_words):
        # No meaningful word from our ingredient appears in the returned label → false match
        return False

    return True




# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _fetch_label(field: str, value: str) -> dict | None:
    """Hit the openFDA label endpoint and return the first result dict."""
    encoded = value.replace(" ", "+")
    url = (
        f"https://api.fda.gov/drug/label.json"
        f"?search={field}:{encoded}&limit=1"
    )

    try:
        resp = requests.get(url, timeout=_REQUEST_TIMEOUT)
    except requests.RequestException:
        return None

    if resp.status_code != 200:
        return None

    data = resp.json()
    results = data.get("results", [])
    return results[0] if results else None


def _extract_fields(result: dict) -> dict:
    """
    Pull the useful label fields from a raw openFDA result dict.

    openFDA stores most text fields as lists of strings — we join them into
    a single string for easier display / LLM consumption.
    """
    extracted: dict[str, str] = {}

    for field in _USEFUL_FIELDS:
        if field in result:
            value = result[field]
            if isinstance(value, list):
                extracted[field] = " ".join(value).strip()
            elif isinstance(value, str):
                extracted[field] = value.strip()

    # Also surface the brand / generic names from the openfda sub-object
    openfda = result.get("openfda", {})
    for meta_field in ["brand_name", "generic_name", "manufacturer_name", "product_type"]:
        values = openfda.get(meta_field)
        if values:
            extracted[f"openfda_{meta_field}"] = ", ".join(values)

    return extracted