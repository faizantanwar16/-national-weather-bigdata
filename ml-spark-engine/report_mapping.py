"""
Contract between this ML/Spark layer and the national backend Mongo `Report` schema.

The dashboard and backend-api are the source of truth for field names and enums.
This module is the only place that translates collector/ML output into those names.
Do not change backend-api or frontend-dashboard to match this folder.
"""
from datetime import datetime, timezone
from typing import Any

import pandas as pd

# Must match backend-api/src/models/Report.ts EventCategory
CATEGORIES = (
    "rainfall",
    "thunderstorm",
    "flooding",
    "heatwave",
    "fog",
    "dust_storm",
    "strong_winds",
    "other",
)

# Older model / labeling-sheet names -> backend names
CATEGORY_ALIASES = {
    "flood": "flooding",
    "floods": "flooding",
    "strong_wind": "strong_winds",
    "strong wind": "strong_winds",
    "uncertain": "other",
}

SOURCE_TYPE = {
    "bluesky": "social",
    "mastodon": "social",
    "twitter": "social",
    "citizen": "citizen",
    "news": "news",
    "openweathermap": "api",
    "weatherapi": "api",
    "imd": "api",
}

PRECISION_FROM_GEO = {
    "gps": "exact",
    "gazetteer": "city",
    "state_only": "state",
}

B32 = "0123456789bcdefghjkmnpqrstuvwxyz"
MIN_CLASSIFIER_CONF = 0.45


def _normalize_label(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def canonicalize_category(value: Any) -> str:
    """Map any model/keyword label onto a backend EventCategory."""
    raw = _normalize_label(value)
    mapped = CATEGORY_ALIASES.get(raw, raw)
    return mapped if mapped in CATEGORIES else "other"


def training_label(value: Any) -> str:
    """Like canonicalize_category, but blanks/typos stay blank so they are dropped from training."""
    raw = _normalize_label(value)
    mapped = CATEGORY_ALIASES.get(raw, raw)
    return mapped if mapped in CATEGORIES else ""


def _missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _text(value: Any, default: str = "") -> str:
    if _missing(value):
        return default
    return str(value).strip()


def _float(value: Any):
    if _missing(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any):
    if _missing(value):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _dt(value: Any):
    if _missing(value):
        return None
    ts = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(ts):
        return None
    return ts.to_pydatetime()


def _now():
    return datetime.now(timezone.utc)


def _as_list(value: Any) -> list:
    if _missing(value) or value is False:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if not _missing(x) and str(x).strip()]
    text = str(value).strip()
    if not text:
        return []
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [p.strip().strip("'\"") for p in inner.split(",") if p.strip().strip("'\"")]
    sep = ";" if ";" in text and "," not in text else ","
    if sep in text or " " in text and "#" in text:
        parts = text.replace("#", " ").replace(sep, " ").split()
        return [p.strip(" #") for p in parts if p.strip(" #")]
    if sep in text:
        return [p.strip().lstrip("#") for p in text.split(sep) if p.strip()]
    return [text.lstrip("#")] if text else []


def geohash_encode(lat: float, lng: float, precision: int = 7) -> str:
    """Same 7-char geohash the backend stores (SRS 6.1)."""
    lat_r, lng_r = [-90.0, 90.0], [-180.0, 180.0]
    hash_, bit, ch, even = "", 0, 0, True
    while len(hash_) < precision:
        r, v = (lng_r, lng) if even else (lat_r, lat)
        mid = (r[0] + r[1]) / 2
        if v >= mid:
            ch = (ch << 1) | 1
            r[0] = mid
        else:
            ch <<= 1
            r[1] = mid
        even = not even
        bit += 1
        if bit == 5:
            hash_ += B32[ch]
            bit, ch = 0, 0
    return hash_


def location_precision(row: dict) -> str:
    method = _text(row.get("geo_method")).lower()
    if method in PRECISION_FROM_GEO:
        return PRECISION_FROM_GEO[method]
    city, state = _text(row.get("city")), _text(row.get("state"))
    if city:
        return "city"
    if state:
        return "state"
    return "unknown"


def source_type_of(row: dict) -> str:
    raw = _text(row.get("source") or row.get("sourceType")).lower()
    if raw in ("citizen", "social", "api", "news"):
        return raw
    return SOURCE_TYPE.get(raw, "social")


def source_id_of(row: dict, source_type: str) -> str:
    existing = _text(row.get("sourceId"))
    if existing:
        return existing
    raw = _text(row.get("source")).lower() or source_type
    if ":" in raw:
        return raw
    return f"{source_type}:{raw}"


def _media(row: dict) -> list:
    urls = _as_list(row.get("media_urls") or row.get("media"))
    types = _as_list(row.get("media_types"))
    out = []
    for i, url in enumerate(urls):
        kind = types[i].lower() if i < len(types) else ""
        out.append({
            "url": url,
            "type": "video" if "video" in kind else "image",
        })
    return out


def _trust_score(row: dict) -> int:
    if not _missing(row.get("trustScore")):
        n = _float(row.get("trustScore"))
        return max(0, min(100, int(round(n)))) if n is not None else 0
    cred = _float(row.get("credibility"))
    if cred is None:
        return 0
    scaled = cred * 100 if cred <= 1 else cred
    return max(0, min(100, int(round(scaled))))


def _trust_reasons(row: dict) -> list:
    value = row.get("trustReasons")
    if isinstance(value, list):
        return [str(x) for x in value if str(x).strip()]
    text = _text(row.get("trustReasons") or row.get("credibility_reasons"))
    if not text:
        return []
    return [p.strip() for p in text.split(";") if p.strip()]


def _trust_breakdown(row: dict) -> dict | None:
    value = row.get("trustBreakdown")
    if isinstance(value, dict) and value:
        return value
    return None


def to_report_document(row: Any) -> dict:
    """One enriched post (Series/dict) -> Mongo Report document."""
    if hasattr(row, "to_dict"):
        row = {k: row[k] for k in row.index}
    row = dict(row)

    category = canonicalize_category(row.get("category") if not _missing(row.get("category")) else row.get("event"))
    conf = _float(row.get("categoryConfidence") if not _missing(row.get("categoryConfidence")) else row.get("event_conf")) or 0.0
    low_conf = bool(row.get("lowConfidence")) if not _missing(row.get("lowConfidence")) else (
        conf < MIN_CLASSIFIER_CONF or category == "other"
    )

    lat, lon = _float(row.get("lat")), _float(row.get("lon"))
    precision = location_precision(row)
    source_type = source_type_of(row)
    report_id = _text(row.get("reportId") or row.get("post_id") or row.get("uri") or row.get("url"))
    if not report_id:
        raise ValueError("Report is missing reportId / post_id / uri / url")

    submitted = _dt(row.get("submittedAt") or row.get("created_at")) or _now()
    ingested = _dt(row.get("ingestedAt") or row.get("collected_at") or row.get("processed_at")) or _now()
    status = _text(row.get("verificationStatus") or row.get("verification_status")) or "needs_review"
    if status == "pending":
        status = "needs_review"
    if status not in ("pending", "needs_review", "verified", "rejected"):
        status = "needs_review"

    raw_text = _text(row.get("rawText") or row.get("text"))
    if not raw_text:
        raise ValueError(f"Report {report_id} is missing rawText/text")

    doc = {
        "reportId": report_id,
        "sourceType": source_type,
        "sourceId": source_id_of(row, source_type),
        "sourceRef": _text(row.get("sourceRef") or row.get("uri") or row.get("url")) or None,
        "rawText": raw_text,
        "language": _text(row.get("language")) or "en",
        "hashtags": _as_list(row.get("hashtags")),
        "submittedAt": submitted,
        "ingestedAt": ingested,
        "locationPrecision": precision,
        "city": _text(row.get("city")) or None,
        "state": _text(row.get("state")) or None,
        "district": _text(row.get("district")) or None,
        "media": _media(row),
        "category": category,
        "categoryConfidence": round(conf, 2),
        "lowConfidence": low_conf,
        "modelVersion": _text(row.get("modelVersion")) or "py-tfidf-1.0.0",
        "trustScore": _trust_score(row),
        "trustReasons": _trust_reasons(row),
        "verificationStatus": status,
        "verifiedBy": None,
    }

    breakdown = _trust_breakdown(row)
    if breakdown:
        doc["trustBreakdown"] = breakdown

    if lat is not None and lon is not None and precision != "unknown":
        doc["location"] = {"type": "Point", "coordinates": [lon, lat]}
        doc["geohash"] = geohash_encode(lat, lon)

    observation = row.get("observation")
    if isinstance(observation, dict) and observation:
        doc["observation"] = observation

    claimed = row.get("claimedCategory")
    if not _missing(claimed):
        doc["claimedCategory"] = canonicalize_category(claimed)

    return {k: v for k, v in doc.items() if v is not None}


def reports_from_frame(df: pd.DataFrame) -> list:
    if df is None or df.empty:
        return []
    docs = []
    for row in df.to_dict("records"):
        try:
            docs.append(to_report_document(row))
        except ValueError:
            continue
    return docs


def notable_observation(row: dict) -> bool:
    rain = _float(row.get("rain_mm")) or 0
    temp = _float(row.get("temp_c")) or 0
    vis = _float(row.get("visibility_km"))
    wind = _float(row.get("wind_kph")) or 0
    return rain > 0 or temp >= 40 or (vis is not None and vis < 1) or wind >= 40


def claimed_from_observation(row: dict) -> str:
    rain = _float(row.get("rain_mm")) or 0
    temp = _float(row.get("temp_c")) or 0
    vis = _float(row.get("visibility_km"))
    wind = _float(row.get("wind_kph")) or 0
    if rain > 0:
        return "rainfall"
    if temp >= 40:
        return "heatwave"
    if vis is not None and vis < 1:
        return "fog"
    if wind >= 40:
        return "strong_winds"
    return "other"


def to_observation_document(row: Any) -> dict | None:
    """Weather-API reading -> Mongo Report with sourceType 'api' and an observation payload."""
    if hasattr(row, "to_dict"):
        row = {k: row[k] for k in row.index}
    row = dict(row)
    if not notable_observation(row):
        return None

    source = _text(row.get("source")) or "openweathermap"
    city = _text(row.get("city"))
    observed = _dt(row.get("observed_at")) or _now()
    temp = _float(row.get("temp_c"))
    wind = _float(row.get("wind_kph"))
    vis_km = _float(row.get("visibility_km"))
    rain = _float(row.get("rain_mm"))
    condition = _text(row.get("condition")) or "observation"
    report_id = f"api:{source}:{city}:{observed.isoformat()}"

    wind_txt = f"{wind:.0f}" if wind is not None else "n/a"
    vis_txt = f"{vis_km:.1f}" if vis_km is not None else "n/a"
    rain_txt = f", rain {rain} mm" if rain else ""
    temp_txt = f"{temp:.0f}" if temp is not None else "n/a"
    text = f"Observation: {condition}, {temp_txt} C, wind {wind_txt} km/h, visibility {vis_txt} km{rain_txt}"

    vis_m = None if vis_km is None else vis_km * 1000
    payload = {
        **row,
        "reportId": report_id,
        "source": source,
        "sourceType": "api",
        "sourceId": f"api:{source}",
        "rawText": text,
        "text": text,
        "created_at": observed,
        "collected_at": observed,
        "category": claimed_from_observation(row),
        "categoryConfidence": 1.0,
        "lowConfidence": False,
        "claimedCategory": claimed_from_observation(row),
        "trustScore": 95,
        "trustReasons": ["Official source on the allow-list (fixed score 95)"],
        "verificationStatus": "needs_review",
        "geo_method": "gps" if _float(row.get("lat")) is not None else "none",
        "observation": {
            "precipMm": rain,
            "tempC": temp,
            "visibilityM": vis_m,
            "windKmh": wind,
        },
        "modelVersion": "weather-api-observation",
    }
    return to_report_document(payload)


def observation_reports_from_frame(df: pd.DataFrame) -> list:
    if df is None or df.empty:
        return []
    docs = []
    for row in df.to_dict("records"):
        doc = to_observation_document(row)
        if doc:
            docs.append(doc)
    return docs
