"""
NPRA (National Pharmaceutical Regulatory Agency) service.

Searches the Supabase pharmaceutical_products table for a direct normalized match
to the OCR-extracted medicine/product name.
"""

import logging
import re
from collections import Counter

from app.config import supabase

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Verification thresholds
_MIN_MATCH_SCORE = 65

# Verification score bands
# VERIFIED: >= 85
# PROBABLE: 65 - 84
# UNVERIFIED: < 65
_VERIFIED_THRESHOLD  = 85
_PROBABLE_THRESHOLD  = 65

_STRENGTH_PATTERN = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|ml|%)(?:/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|ml|%))?\b",
    re.IGNORECASE,
)


def _log_preview(text: str, limit: int = 200) -> str:
    preview = text.replace("\r", " ").replace("\n", " | ").strip()
    return preview[:limit] + ("…" if len(preview) > limit else "")


def normalize_product_name(text: str) -> str:
    """Normalize OCR or CSV product text for strict equality matching."""
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _extract_strength_tokens(text: str) -> list[str]:
    normalized = (text or "").lower().replace("\n", " ")
    tokens = [re.sub(r"\s+", " ", match.group(0)).strip() for match in _STRENGTH_PATTERN.finditer(normalized)]
    return list(dict.fromkeys(tokens))


def _source_contains(normalized_source: str, value: str | None) -> bool:
    if not value:
        return False
    normalized_value = normalize_product_name(value)
    return bool(normalized_value and normalized_value in normalized_source)


_RELATED_COMPANY_GROUPS = [
    # Pfizer / Viatris / Mylan / Upjohn / contract manufacturers
    {"pfizer", "viatris", "mylan", "upjohn", "fareva", "wyeth", "warner lambert", "pharmacia"},
    # GSK / Haleon / Panadol
    {"glaxosmithkline", "gsk", "haleon", "beecham", "glaxo", "wellcome", "smithkline", "panadol"},
    # AstraZeneca
    {"astrazeneca", "az", "astra", "zeneca", "medimmune"},
    # Sanofi
    {"sanofi", "aventis", "zentiva", "genzyme", "winthrop", "hoechst"},
    # Novartis
    {"novartis", "sandoz", "alcon", "ciba geigy"},
    # Merck
    {"merck", "msd", "merck sharp dohme", "schering plough", "organon"},
    # J&J
    {"johnson johnson", "johnson and johnson", "j j", "janssen", "cilag", "mcneil"},
    # Roche
    {"roche", "genentech", "chugai"},
    # Bayer
    {"bayer", "schering"},
    # Abbott
    {"abbott", "abbvie"},
    # BMS
    {"bristol myers squibb", "bms", "squibb", "bristol myers"},
    # Takeda
    {"takeda", "shire"},
    # Vitaherb / Winwa
    {"vitaherb", "winwa", "winwa medical"},
]


def _clean_company_name(name: str) -> str:
    stop_words = {
        "sdn", "bhd", "ltd", "co", "inc", "fty", "pharm", "pharmaceutical", 
        "factory", "limited", "company", "sendirian", "berhad", "llp", 
        "plc", "group", "holdings", "holding", "corp", "corporation"
    }
    words = name.split()
    cleaned = [w for w in words if w not in stop_words]
    return " ".join(cleaned) if cleaned else name


def _are_companies_related(c1: str | None, c2: str | None) -> bool:
    if not c1 or not c2:
        return False
    
    n1 = normalize_product_name(c1)
    n2 = normalize_product_name(c2)
    
    if not n1 or not n2:
        return False
        
    # Direct token or substring match
    if n1 in n2 or n2 in n1:
        return True
        
    # Cleaned match (removes common suffixes)
    c1_clean = _clean_company_name(n1)
    c2_clean = _clean_company_name(n2)
    if c1_clean and len(c1_clean) > 2 and c2_clean and len(c2_clean) > 2:
        if c1_clean in c2_clean or c2_clean in c1_clean:
            return True
        
    # Check our groups
    for group in _RELATED_COMPANY_GROUPS:
        # Check if one of the group items is in n1 AND another group item is in n2
        has_member_1 = any(item in n1 for item in group)
        has_member_2 = any(item in n2 for item in group)
        if has_member_1 and has_member_2:
            return True
            
    return False


def _label_matches(detected_value: str | None, row_value: str | None, normalized_source: str) -> bool:
    if not detected_value or not row_value:
        return False
    normalized_detected = normalize_product_name(detected_value)
    normalized_row = normalize_product_name(row_value)
    if not normalized_detected or not normalized_row:
        return False
    if normalized_detected == normalized_row:
        return True
    if normalized_detected in normalized_row or normalized_row in normalized_detected:
        return True
    if _are_companies_related(detected_value, row_value):
        return True
    return bool(normalized_detected in normalized_source and normalized_row in normalized_source)


def search_npra_product(
    ocr_text: str,
    source_text: str | None = None,
    detected_manufacturer: str | None = None,
    detected_company: str | None = None,
) -> dict | None:
    """
    Return a product record when the normalized OCR text directly matches a
    Supabase product name, or is contained in one.
    """
    if not ocr_text or not ocr_text.strip():
        return None

    query = ocr_text.strip()
    normalized_query = normalize_product_name(query)
    logger.info("NPRA search query: %s", _log_preview(query))
    logger.info("NPRA normalized query: %s", _log_preview(normalized_query))

    if not normalized_query:
        return None

    normalized_source = normalize_product_name(source_text or ocr_text)
    source_strengths = _extract_strength_tokens(source_text or ocr_text)

    best_row = None
    match_mode = "exact"
    candidates = []

    # 1. Match by Registration Number (MAL...)
    mal_match = re.search(r"\b(MAL\d+[A-Z]*)\b", source_text or ocr_text, re.IGNORECASE)
    if mal_match:
        mal_no = mal_match.group(1).upper()
        # Find exact MAL number match in Supabase
        res = supabase.table("pharmaceutical_products").select("*").ilike("reg_no", f"{mal_no}%").execute()
        if res.data:
            best_row = res.data[0]
            match_mode = "mal_number"
            logger.info("NPRA match via MAL number: %s", mal_no)

    # 2. Exact match
    if not best_row:
        res = supabase.table("pharmaceutical_products").select("*").ilike("product", normalized_query).execute()
        if res.data:
            best_row = res.data[0]
            match_mode = "exact"

    # 3. Contains match
    if not best_row:
        res = supabase.table("pharmaceutical_products").select("*").ilike("product", f"%{normalized_query}%").limit(50).execute()
        if res.data:
            candidates.extend(res.data)

    # 4. Fallback 1: company-anchored search
    if not best_row and not candidates:
        for brand_hint in filter(None, [detected_company, detected_manufacturer]):
            brand_key = normalize_product_name(brand_hint)
            if brand_key and len(brand_key) >= 4:
                res = supabase.table("pharmaceutical_products").select("*").ilike("product", f"{brand_key}%").limit(50).execute()
                if res.data:
                    candidates.extend(res.data)
                    logger.info("NPRA fallback 1 (company-anchored '%s'): %d candidates", brand_key, len(res.data))
                    break

    # 5. Fallback 2: token-based partial match
    if not best_row and not candidates:
        query_tokens = [t for t in normalized_query.split() if len(t) >= 4]
        if query_tokens:
            or_conditions = ",".join([f"product.ilike.%{t}%" for t in query_tokens])
            res = supabase.table("pharmaceutical_products").select("*").or_(or_conditions).limit(100).execute()
            if res.data:
                for row in res.data:
                    product_key = normalize_product_name(row.get("product", ""))
                    hits = sum(1 for t in query_tokens if t in product_key)
                    if hits >= max(1, len(query_tokens) // 2):
                        candidates.append(row)
                logger.info("NPRA fallback 2 (token-based tokens=%s): %d candidates", query_tokens, len(candidates))

    if not best_row and not candidates:
        logger.info("NPRA direct match: no result")
        return None

    if not best_row and candidates:
        def _candidate_score(row: dict) -> tuple[int, int, int, int, int, int]:
            product_value = row.get("product", "") or ""
            product_key = normalize_product_name(product_value)
            manufacturer_value = row.get("manufacturer", "") or ""
            holder_value = row.get("holder", "") or ""
            generic_value = row.get("generic_name", "") or ""
            active_ingredient_value = row.get("active_ingredient", "") or ""

            product_exact = 1 if product_key == normalized_query else 0
            prefix_match = 1 if product_key.startswith(normalized_query) else 0
            strength_hits = 0
            for token in source_strengths:
                token_norm = normalize_product_name(token)
                if token_norm and token_norm in normalize_product_name(product_value + " " + active_ingredient_value + " " + generic_value):
                    strength_hits += 1

            # Company match
            company_hits = 0
            for det in filter(None, [detected_company, detected_manufacturer]):
                if det and (_are_companies_related(det, manufacturer_value) or
                            _are_companies_related(det, holder_value)):
                    company_hits += 2
            for value in (manufacturer_value, holder_value):
                if _source_contains(normalized_source, value):
                    company_hits += 1

            # Source-text token overlap
            _stop_tokens = {"syrup", "tablet", "capsule", "oral", "solution",
                            "cream", "used", "traditionally", "reducing",
                            "cough", "throat"}
            source_tokens = [
                t for t in normalized_source.split()
                if len(t) >= 5 and t not in _stop_tokens
            ]
            source_token_hits = sum(1 for t in source_tokens if t in product_key) if source_tokens else 0

            # Query token overlap
            query_tokens = [t for t in normalized_query.split() if len(t) >= 4]
            token_hits = sum(1 for t in query_tokens if t in product_key) if query_tokens else 0

            return (
                product_exact,
                company_hits,
                source_token_hits,
                token_hits,
                strength_hits,
                prefix_match,
            )

        candidates.sort(key=lambda item: _candidate_score(item), reverse=True)
        best_row = candidates[0]
        match_mode = "contains"

    if not best_row:
        logger.info("NPRA direct match: no result")
        return None

    def _val(col: str) -> str | None:
        v = best_row.get(col)
        if v is None or str(v).strip() in ("", "nan", "None"):
            return None
        return str(v).strip()

    product_value = _val("product")
    manufacturer_value = _val("manufacturer")
    holder_value = _val("holder")
    active_ingredient_value = _val("active_ingredient")
    generic_name_value = _val("generic_name")

    strength_hits = []
    product_strength_source = " ".join(filter(None, [product_value, active_ingredient_value, generic_name_value]))
    product_strength_norm = normalize_product_name(product_strength_source)
    for token in source_strengths:
        token_norm = normalize_product_name(token)
        if token_norm and token_norm in product_strength_norm and token not in strength_hits:
            strength_hits.append(token)

    company_hits: list[str] = []
    company_mismatch = False
    if detected_manufacturer or detected_company:
        manufacturer_match = _label_matches(detected_manufacturer, manufacturer_value, normalized_source)
        holder_match = _label_matches(detected_company, holder_value, normalized_source)
        company_match = manufacturer_match or holder_match
        if company_match:
            if manufacturer_match:
                company_hits.append("manufacturer")
            if holder_match:
                company_hits.append("company holder")
        else:
            company_mismatch = True
    else:
        for label, value in (("manufacturer", manufacturer_value), ("company holder", holder_value)):
            if value and _source_contains(normalized_source, value):
                company_hits.append(label)

    score = 70 if match_mode in ("exact", "mal_number") else 60
    notes: list[str] = []

    if match_mode == "mal_number":
        notes.append("Registration number matched")
    elif match_mode == "exact":
        notes.append("Exact product name match")
    else:
        notes.append("Product name matched")

    if strength_hits:
        score += 15
        notes.append(f"Strength: {', '.join(strength_hits)}")
    else:
        notes.append("Strength not clear")

    if company_hits:
        score += min(15, len(company_hits) * 10)
        notes.append(f"Company: {', '.join(company_hits)}")
    else:
        logger.info("NPRA match rejected: missing or mismatched company.")
        return {
            "rejected_reason": f"Malaysia has a registered product named '{_val('product')}' from '{_val('manufacturer') or _val('holder')}', but your label's manufacturer does not match. This specific product is unregistered."
        }

    if match_mode == "contains" and normalized_query not in normalized_source:
        notes.append("OCR cleaned by LLM")

    score = float(min(score, 100))

    if match_mode == "mal_number":
        product_part = "an exact match for the registration number"
    elif match_mode == "exact":
        product_part = "an exact match for the product name"
    else:
        product_part = "a match for the product name"
        
    if strength_hits and company_hits:
        reason = f"We found {product_part}, its dosage amount ({', '.join(strength_hits)}), and the {' and '.join(company_hits)}."
    elif not strength_hits and company_hits:
        reason = f"We found {product_part} and the {' and '.join(company_hits)}, but the dosage amount wasn't clearly stated on the label."
    else:
        reason = f"We found {product_part}."

    # Enforce minimum score threshold
    if score < _MIN_MATCH_SCORE:
        logger.info(
            "NPRA match rejected: score %.0f < threshold %d (product=%s)",
            score, _MIN_MATCH_SCORE, product_value,
        )
        return None

    # Assign verification status
    if score >= _VERIFIED_THRESHOLD:
        verification_status = "VERIFIED"
    elif score >= _PROBABLE_THRESHOLD:
        verification_status = "PROBABLE"
    else:
        verification_status = "UNVERIFIED"

    return {
        "product":            _val("product"),
        "registration_no":    _val("reg_no"),
        "status":             _val("status"),
        "description":        _val("description"),
        "holder":             _val("holder"),
        "manufacturer":       _val("manufacturer"),
        "active_ingredient":  _val("active_ingredient"),
        "generic_name":       _val("generic_name"),
        "match_score":        score,
        "match_mode":         match_mode,
        "match_reason":       reason,
        "match_details":      notes,
        "strength_matches":   strength_hits,
        "company_matches":    company_hits,
        "verification_status": verification_status,
    }