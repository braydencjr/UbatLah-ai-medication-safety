import pytest
import os
import sys

# Ensure backend path is in sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.npra_service import search_npra_product

def test_hurixs_fluaway_verification():
    """
    Test that 'HURIX'S 600 Fluaway Capsule' correctly matches the Improved Capsule
    and aggressively rejects 'Hurix S Perfumed Medicated Powder' due to low overlap ratio.
    """
    ocr_text = "HURIX'S 600 Fluaway Capsule"
    source_text = "HURIX'S | TM | CAPSULE | 600 Fluaway | IMPROVED | 好力600伤风胶囊 | HALAL | MS 2424 | 5 019-02/2010 | Traditionally used for relief of Flu and Common Cold, Running Nose | and Nasal Congestion | • 传统上用于解除伤风，流涕及鼻塞 | C012345678 | 01/23"
    
    # Mock LLM outputs
    detected_company = "HURIX'S"
    detected_manufacturer = "HURIX'S"
    
    result = search_npra_product(
        ocr_text=ocr_text,
        source_text=source_text,
        detected_company=detected_company,
        detected_manufacturer=detected_manufacturer
    )
    
    assert result is not None, "Product should not be rejected completely."
    
    # Check that we got the exact correct product
    assert "Capsule" in result["product"], "Matched product must be the capsule variant, not powder or syrup."
    assert "Fluaway" in result["product"], "Matched product must contain 'Fluaway'."
    
    # Ensure it didn't pick the perfumed medicated powder
    assert "Perfumed Medicated Powder" not in result["product"], "Overlap threshold filter failed! Picked irrelevant medicated powder."
    
    # Verify score is populated and high (likely >= 60)
    assert result.get("match_score", 0) > 60, f"Score should be high, got {result.get('match_score')}"

