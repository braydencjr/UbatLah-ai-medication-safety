import sys
import os
from pathlib import Path

# Add backend directory to Python path
sys.path.append(str(Path(__file__).resolve().parent.parent.parent))

from app.services.npra_sync_service import run_pipeline
import logging

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    logger = logging.getLogger("run_npra_sync")
    logger.info("Starting standalone NPRA Sync...")
    
    # Supabase credentials are required
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_KEY"):
        logger.error("Missing SUPABASE_URL or SUPABASE_KEY environment variables.")
        sys.exit(1)
        
    try:
        run_pipeline()
        logger.info("NPRA Sync completed.")
        sys.exit(0)
    except Exception as e:
        logger.error(f"NPRA Sync failed: {e}")
        sys.exit(1)
