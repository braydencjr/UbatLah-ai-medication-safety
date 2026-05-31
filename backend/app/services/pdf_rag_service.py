"""
PDF RAG (Retrieval-Augmented Generation) service.
"""

import os
import uuid

from pypdf import PdfReader
import chromadb
from sentence_transformers import SentenceTransformer

from app.config import CHROMA_DIR

# ChromaDB client
os.makedirs(CHROMA_DIR, exist_ok=True)

_chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
_COLLECTION_NAME = "patient_case"

_collection = _chroma_client.get_or_create_collection(
    name=_COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"},
)

# Embedding model
_embed_model = SentenceTransformer("all-MiniLM-L6-v2")

# Chunking parameters
_CHUNK_WORDS = 150      # target chunk size in words
_CHUNK_OVERLAP = 30     # overlap between consecutive chunks (words)


# Public API

def clear_patient_data() -> dict:
    """Delete the current patient collection and recreate an empty one."""
    global _collection
    try:
        _chroma_client.delete_collection(_COLLECTION_NAME)
    except Exception:
        pass

    _collection = _chroma_client.get_or_create_collection(
        name=_COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    return {"success": True, "message": "Patient data cleared."}

# Automatically clear any previous patient data on server startup
clear_patient_data()


def index_patient_pdf(file_path: str) -> dict:
    """Parse a PDF, chunk its text, embed each chunk and upsert into ChromaDB."""
    global _collection

    text = _extract_pdf_text(file_path)
    if not text.strip():
        return {
            "success": False,
            "message": "Could not extract any text from the PDF.",
            "chunks_indexed": 0,
        }

    chunks = _chunk_text(text, chunk_words=_CHUNK_WORDS, overlap=_CHUNK_OVERLAP)

    clear_patient_data()
    embeddings = _embed_model.encode(chunks, show_progress_bar=False).tolist()

    ids = [str(uuid.uuid4()) for _ in chunks]

    _collection.add(
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
    )

    return {
        "success": True,
        "message": "Patient case indexed successfully.",
        "chunks_indexed": len(chunks),
        "total_characters": len(text),
    }


def retrieve_patient_context(query: str, n_results: int = 4) -> str:
    """
    Embed `query` and return the top-k most semantically similar chunks from
    the patient case collection, joined as a single string.

    Returns an empty string if the collection is empty or the query fails.
    """
    count = _collection.count()
    if count == 0:
        return ""

    # Clamp n_results to what's actually in the collection
    k = min(n_results, count)

    query_embedding = _embed_model.encode([query], show_progress_bar=False).tolist()

    results = _collection.query(
        query_embeddings=query_embedding,
        n_results=k,
        include=["documents"],
    )

    docs: list[str] = results.get("documents", [[]])[0]
    return "\n\n".join(docs)


def get_collection_status() -> dict:
    """Return basic stats about the current patient collection."""
    count = _collection.count()
    return {
        "collection": _COLLECTION_NAME,
        "chunks_stored": count,
        "patient_indexed": count > 0,
    }


# Internal helpers

def _extract_pdf_text(file_path: str) -> str:
    """Read every page of the PDF and concatenate the text."""
    reader = PdfReader(file_path)
    pages: list[str] = []
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            pages.append(page_text)
    return "\n".join(pages)


def _chunk_text(text: str, chunk_words: int = 150, overlap: int = 30) -> list[str]:
    """
    Split text into overlapping word-window chunks.

    Using word-level overlap (rather than character-level) gives more
    predictable chunk sizes across different PDFs.
    """
    words = text.split()
    if not words:
        return []

    step = max(1, chunk_words - overlap)
    chunks = []

    for start in range(0, len(words), step):
        chunk = " ".join(words[start : start + chunk_words])
        if chunk.strip():
            chunks.append(chunk)

    return chunks