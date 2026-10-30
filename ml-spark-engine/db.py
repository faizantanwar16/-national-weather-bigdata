"""
MongoDB and backend-API sink for the national weather platform.

Ingest flow:
1. Preferred: POST /api/reports/ingest into backend-api (SSE push, clustering, audit log).
2. Fallback: Write directly into MongoDB `nwbdap.reports` with insert-or-ignore ($setOnInsert).

SQLite is no longer used.

  python db.py init
  python db.py stats
  python db.py load-observations weather_observations.csv
"""
import json
import os
import sys
from datetime import date, datetime
from urllib.parse import urlparse

import pandas as pd
import requests
from dotenv import load_dotenv
from pymongo import MongoClient, UpdateOne
from pymongo.errors import PyMongoError

from report_mapping import observation_reports_from_frame, reports_from_frame

load_dotenv()

DEFAULT_URI = "mongodb://127.0.0.1:27017/nwbdap"
DEFAULT_API_URL = "http://localhost:4000"
DEFAULT_INGEST_KEY = "national-weather-shared-ingest-key-2026"


def mongo_uri():
    return os.getenv("MONGO_URI", DEFAULT_URI).strip() or DEFAULT_URI


def _client():
    return MongoClient(mongo_uri())


def _db_name(uri):
    path = urlparse(uri).path.strip("/")
    return path.split("/")[0] if path else "nwbdap"


def connect():
    uri = mongo_uri()
    return _client()[_db_name(uri)]


def init_db():
    db = connect()
    reports = db["reports"]
    reports.create_index("reportId", unique=True)
    reports.create_index([("location", "2dsphere")])
    reports.create_index([("submittedAt", -1)])
    reports.create_index([("category", 1), ("verificationStatus", 1), ("submittedAt", -1)])
    reports.create_index([("state", 1), ("submittedAt", -1)])
    reports.create_index([("sourceType", 1), ("submittedAt", -1)])
    db["sources"].create_index("sourceId", unique=True)
    return db


def _upsert_reports(docs):
    """Fallback: direct Mongo write with insert-or-ignore ($setOnInsert)."""
    if not docs:
        return 0
    db = init_db()
    ops = [
        UpdateOne({"reportId": d["reportId"]}, {"$setOnInsert": d}, upsert=True)
        for d in docs
    ]
    result = db["reports"].bulk_write(ops, ordered=False)
    _ensure_sources(db, docs)
    return (result.upserted_count or 0)


def _ensure_sources(db, docs):
    seen = {}
    for d in docs:
        sid = d.get("sourceId")
        if sid and sid not in seen:
            seen[sid] = d.get("sourceType", "social")
    ops = [
        UpdateOne(
            {"sourceId": sid},
            {"$setOnInsert": {
                "sourceId": sid,
                "type": stype,
                "reliability": 0.95 if stype == "api" else 0.4,
                "reportCount": 0,
                "approvedCount": 0,
                "rejectedCount": 0,
                "blocked": False,
                "allowListed": stype == "api",
            }},
            upsert=True,
        )
        for sid, stype in seen.items()
    ]
    if ops:
        db["sources"].bulk_write(ops, ordered=False)


def _json_serial(obj):
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


def push_to_api(docs, batch_size=100):
    """POST reports into backend-api /api/reports/ingest in batches."""
    api_url = os.getenv("API_URL", DEFAULT_API_URL).rstrip("/")
    key = os.getenv("INGEST_KEY", DEFAULT_INGEST_KEY)
    endpoint = f"{api_url}/api/reports/ingest"

    total_inserted = 0
    for i in range(0, len(docs), batch_size):
        chunk = docs[i : i + batch_size]
        payload = json.loads(json.dumps(chunk, default=_json_serial))
        resp = requests.post(
            endpoint,
            json=payload,
            headers={"x-ingest-key": key, "Content-Type": "application/json"},
            timeout=15,
        )
        if resp.status_code in (200, 201):
            data = resp.json()
            total_inserted += data.get("inserted", 0)
        else:
            raise RuntimeError(f"backend-api returned {resp.status_code}: {resp.text}")
    return total_inserted


def sink_reports(docs):
    """
    Preferred: POST into backend-api (SSE broadcast, clustering, audit logs).
    Fallback: write directly into MongoDB nwbdap.reports using insert-or-ignore.
    """
    if not docs:
        return 0
    if os.getenv("FORCE_DIRECT_MONGO", "").lower() in ("1", "true"):
        return _upsert_reports(docs)

    try:
        inserted = push_to_api(docs)
        return inserted
    except Exception as e:
        # Fallback to direct Mongo upsert
        return _upsert_reports(docs)


def insert_posts(df, path=None):
    """Insert enriched social posts. `path` is ignored (kept so old callers still work)."""
    return sink_reports(reports_from_frame(df))


def insert_observations(df, path=None):
    """Insert notable official readings as sourceType=api reports."""
    return sink_reports(observation_reports_from_frame(df))


def stats():
    db = init_db()
    total = db["reports"].count_documents({})
    print(f"{total} reports in {mongo_uri()}")
    for title, field in (
        ("By event", "category"),
        ("By verification", "verificationStatus"),
        ("By source type", "sourceType"),
        ("Top states", "state"),
    ):
        print(f"\n{title}:")
        for row in db["reports"].aggregate([
            {"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
            {"$sort": {"n": -1}},
            {"$limit": 10},
        ]):
            print(f"  {str(row['_id'] or '(none)'):22s} {row['n']}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if cmd == "init":
            init_db()
            print("Ready:", mongo_uri())
        elif cmd == "stats":
            stats()
        elif cmd == "load-observations" and len(sys.argv) > 2:
            print("Inserted", insert_observations(pd.read_csv(sys.argv[2])), "new observation reports")
        else:
            print(__doc__)
    except (PyMongoError, requests.RequestException) as e:
        print("Error:", e)
        sys.exit(1)
