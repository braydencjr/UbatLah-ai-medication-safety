import pandas as pd
import requests
import tempfile
import logging
import uuid
import datetime
import os
from typing import Optional, Dict, Any, List

from app.config import supabase

logger = logging.getLogger(__name__)

NPRA_PARQUET_URL = "https://storage.data.gov.my/healthcare/pharmaceutical_products.parquet"
LOG_TABLE_NAME = "npra_import_logs"
PRODUCTS_TABLE_NAME = "pharmaceutical_products"


def create_import_log() -> str:
    """Create a new import log entry and return its ID."""
    log_id = str(uuid.uuid4())
    try:
        data = {
            "id": log_id,
            "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "status": "RUNNING"
        }
        supabase.table(LOG_TABLE_NAME).insert(data).execute()
        return log_id
    except Exception as e:
        logger.error(f"Failed to create import log: {e}")
        return log_id  # Return ID even if failed, we will try to update it later


def update_import_log(log_id: str, status: str, record_count: Optional[int] = None, error_message: Optional[str] = None):
    """Update an existing import log entry."""
    try:
        data = {
            "status": status,
            "completed_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        if record_count is not None:
            data["record_count"] = record_count
        if error_message is not None:
            data["error_message"] = error_message
            
        supabase.table(LOG_TABLE_NAME).update(data).eq("id", log_id).execute()
    except Exception as e:
        logger.error(f"Failed to update import log {log_id}: {e}")


def download_dataset() -> str:
    """Download the NPRA parquet dataset to a temporary file."""
    logger.info(f"Downloading NPRA dataset from {NPRA_PARQUET_URL}...")
    response = requests.get(NPRA_PARQUET_URL, stream=True)
    response.raise_for_status()

    # Create a temporary file
    fd, temp_path = tempfile.mkstemp(suffix=".parquet")
    with os.fdopen(fd, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
            
    logger.info(f"Downloaded to {temp_path}")
    return temp_path


def transform_dataset(file_path: str) -> pd.DataFrame:
    """Load the dataset using pandas, normalize and clean the data."""
    logger.info("Transforming dataset...")
    df = pd.read_parquet(file_path)
    
    # Normalize column names (lowercase, replace spaces with underscores)
    df.columns = [str(col).strip().lower().replace(" ", "_") for col in df.columns]
    
    # Required columns check
    required_columns = ["reg_no", "product"]
    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        raise ValueError(f"Missing required columns in dataset: {missing_columns}")

    # Handle null values before aggregation to avoid NaN issues
    df = df.where(pd.notnull(df), None)

    initial_count = len(df)

    # Function to merge unique non-null string values
    def merge_unique(series):
        # Filter out None/NaN and empty strings
        valid_values = [str(x).strip() for x in series.dropna() if str(x).strip() and str(x).strip().lower() != "nan" and str(x).strip().lower() != "none"]
        # Deduplicate while preserving order
        seen = set()
        unique_vals = [x for x in valid_values if not (x in seen or seen.add(x))]
        return " | ".join(unique_vals) if unique_vals else None

    # We want to keep 'first' for most columns (e.g. product, status, active_ingredient)
    # but aggregate manufacturer, importer, and holder.
    agg_dict = {}
    for col in df.columns:
        if col == 'reg_no':
            continue
        elif col in ['manufacturer', 'importer', 'holder']:
            agg_dict[col] = merge_unique
        else:
            # We use a lambda to get the first non-null value, or fallback to simple 'first'
            agg_dict[col] = lambda x: next((item for item in x if pd.notnull(item)), None)

    # Group by reg_no to ensure 1 medicine = 1 row
    df = df.groupby('reg_no', as_index=False).agg(agg_dict)
    
    # Convert date columns to ISO string format for JSON serialization
    for col in ["date_reg", "date_end"]:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce").dt.strftime("%Y-%m-%d")
    
    import numpy as np
    # Handle any NaNs or Infs generated during aggregation (convert to None for JSON serialization)
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.astype(object).where(pd.notnull(df), None)
    
    logger.info(f"Aggregated {initial_count} raw rows into {len(df)} unique reg_no entries.")

    if df.empty:
        raise ValueError("Dataset is empty after transformation.")

    return df


def sync_to_supabase(df: pd.DataFrame, batch_size: int = 1000) -> int:
    """Sync the dataframe to Supabase using batch upserts."""
    records = df.to_dict(orient="records")
    
    # Final validation: Ensure all Python date/datetime objects are string serialized
    for record in records:
        for key, value in record.items():
            if isinstance(value, (datetime.date, datetime.datetime)):
                record[key] = value.isoformat()
            # Also catch any NaT pandas leaves behind
            elif str(value).lower() == "nat":
                record[key] = None

    total_records = len(records)
    logger.info(f"Starting upsert of {total_records} records in batches of {batch_size}...")

    upserted_count = 0
    for i in range(0, total_records, batch_size):
        batch = records[i:i + batch_size]
        try:
            # upsert requires reg_no to be a unique constraint or primary key
            supabase.table(PRODUCTS_TABLE_NAME).upsert(batch, on_conflict="reg_no").execute()
            upserted_count += len(batch)
            logger.info(f"Upserted batch {i//batch_size + 1} ({upserted_count}/{total_records})")
        except Exception as e:
            logger.error(f"Failed to upsert batch starting at index {i}: {e}")
            raise  # Reraise to fail the sync process
            
    return upserted_count


def run_pipeline() -> None:
    """Main orchestrator for the NPRA synchronization pipeline."""
    logger.info("Starting NPRA sync pipeline...")
    log_id = create_import_log()
    temp_file = None
    
    try:
        # Extract
        temp_file = download_dataset()
        
        # Transform
        df = transform_dataset(temp_file)
        
        # Load
        record_count = sync_to_supabase(df)
        
        # Success
        update_import_log(log_id, status="SUCCESS", record_count=record_count)
        logger.info(f"Pipeline completed successfully. Upserted {record_count} records.")
        
    except Exception as e:
        logger.error(f"Pipeline failed: {e}")
        update_import_log(log_id, status="FAILED", error_message=str(e))
        
    finally:
        # Clean up temporary file
        if temp_file and os.path.exists(temp_file):
            os.remove(temp_file)
            logger.info(f"Removed temporary file {temp_file}")

if __name__ == "__main__":
    # Configure basic logging if run directly
    logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    run_pipeline()
