import os, sys
sys.path.append(os.getcwd())
from app.config import supabase
from app.services.npra_service import normalize_product_name, _extract_strength_tokens, _are_companies_related, _source_contains

ocr_text = "HURIX'S 600 Fluaway"
source_text = "HURIX'S | TM | CAPSULE | 600 Fluaway | IMPROVED | 好力600伤风胶囊 | HALAL | MS 2424 | 5 019-02/2010 | Traditionally used for relief of Flu and Common Cold, Running Nose | and Nasal Congestion | • 传统上用于解除伤风，流涕及鼻塞 | C012345678 | 01/23"

detected_company = "HURIX'S"
detected_manufacturer = "HURIX'S"

query = ocr_text.strip()
normalized_query = normalize_product_name(query)
normalized_source = normalize_product_name(source_text or ocr_text)
source_strengths = _extract_strength_tokens(source_text or ocr_text)

query_tokens = [t for t in normalized_query.split() if len(t) >= 4]
or_conditions = ",".join([f"product.ilike.%{t}%" for t in query_tokens])
res = supabase.table("pharmaceutical_products").select("*").or_(or_conditions).limit(50).execute()
candidates = res.data

def _candidate_score(row: dict) -> tuple:
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

    company_hits = 0
    for det in filter(None, [detected_company, detected_manufacturer]):
        if det and (_are_companies_related(det, manufacturer_value) or
                    _are_companies_related(det, holder_value)):
            company_hits += 2
        
        det_norm = normalize_product_name(det)
        if det_norm and len(det_norm) >= 3 and det_norm in product_key:
            company_hits += 2

    for value in (manufacturer_value, holder_value):
        if _source_contains(normalized_source, value):
            company_hits += 1

    _stop_tokens = {"syrup", "tablet", "capsule", "oral", "solution",
                    "cream", "used", "traditionally", "reducing",
                    "cough", "throat"}
    source_tokens = [
        t for t in normalized_source.split()
        if len(t) >= 5 and t not in _stop_tokens
    ]
    source_token_hits = sum(1 for t in source_tokens if t in product_key) if source_tokens else 0
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
print("Top 3 Candidates:")
for c in candidates[:3]:
    score = _candidate_score(c)
    print(f"{c['product']} -> Score: {score}")

