import os
from pathlib import Path
from dotenv import load_dotenv

# Resolve project root (backend/) so paths work regardless of CWD
BASE_DIR = Path(__file__).resolve().parent.parent  # backend/

load_dotenv(BASE_DIR / ".env")

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
NPRA_CSV_PATH: str = str(BASE_DIR / "app" / "data" / "pharmaceutical_products.csv")
UPLOAD_DIR: str = str(BASE_DIR / "app" / "uploads")
CHROMA_DIR: str = str(BASE_DIR / "app" / "chroma_db")