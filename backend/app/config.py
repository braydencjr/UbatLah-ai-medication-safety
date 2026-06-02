import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# Resolve project root (backend/) so paths work regardless of CWD
BASE_DIR = Path(__file__).resolve().parent.parent  # backend/

load_dotenv(BASE_DIR / ".env")

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
UPLOAD_DIR: str = str(BASE_DIR / "app" / "uploads")
CHROMA_DIR: str = str(BASE_DIR / "app" / "chroma_db")

SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)