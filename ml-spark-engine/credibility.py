"""
Credibility scorer: explainable weighted features now, learned weights later.

Phase 1 (no labels needed): score() uses hand-set weights.
Phase 2 (after admins verify/reject posts in the dashboard): fit_weights() learns
the weights from those admin verdicts with logistic regression.

Input is a dict (one post). Missing keys are fine, they just score as "unknown".
Useful keys: author, text, account_created_at, followers, has_media, category,
categoryConfidence, geo_confidence, corroboration, duplicate_of
"""
import math
import re

import numpy as np
import pandas as pd

# EDIT: add official / news accounts you have manually confirmed (lowercase handles)
TRUSTED_HANDLES = {"indiametdept"}

CLICKBAIT = r"\b(breaking|shocking|viral|share this|forward this|must watch|100% true|urgent|omg)\b"

FEATURES = ["source_trust", "content_quality", "specificity",
            "media", "corroboration", "originality"]
DEFAULT_WEIGHTS = {"source_trust": 0.30, "content_quality": 0.15, "specificity": 0.15,
                   "media": 0.10, "corroboration": 0.20, "originality": 0.10}
REASONS = {
    "source_trust": "new or low-reach account",
    "content_quality": "sensational or low-quality text",
    "specificity": "no clear location or event",
    "media": "no photo/video",
    "corroboration": "no independent reports of the same event",
    "originality": "duplicate of an earlier post",
}


def _missing(v):
    return v is None or (isinstance(v, float) and math.isnan(v)) or v == ""


def _age_days(value):
    if _missing(value):
        return None
    ts = pd.to_datetime(value, utc=True, errors="coerce")
    if pd.isna(ts):
        return None
    return max((pd.Timestamp.now(tz="UTC") - ts).days, 0)


def extract_features(post):
    text = str(post.get("text", ""))
    author = str(post.get("author", "")).lower()

    # 1. source trust
    if author in TRUSTED_HANDLES:
        trust = 1.0
    else:
        parts = []
        age = _age_days(post.get("account_created_at"))
        if age is not None:
            parts.append(min(age / 365, 1.0))
        followers = post.get("followers")
        if not _missing(followers):
            parts.append(min(math.log10(float(followers) + 1) / 3, 1.0))
        trust = sum(parts) / len(parts) if parts else 0.4   # unknown -> slightly low

    # 2. content quality
    q = 1.0
    letters = [c for c in text if c.isalpha()]
    if letters and sum(c.isupper() for c in letters) / len(letters) > 0.5:
        q -= 0.3
    if text.count("!") >= 3:
        q -= 0.2
    if re.search(CLICKBAIT, text.lower()):
        q -= 0.3
    if len(text.split()) < 5:
        q -= 0.2

    # 3. specificity (do we know where and what?)
    geo = float(post.get("geo_confidence") or 0)
    category = str(post.get("category") or post.get("event") or "")
    conf = post.get("categoryConfidence")
    if conf is None:
        conf = post.get("event_conf") or 0
    event_ok = category not in ("", "other", "uncertain")
    spec = 0.5 * min(geo, 1.0) + 0.5 * (float(conf or 0) if event_ok else 0.0)

    # 4. media, 5. corroboration, 6. originality
    has_media = post.get("has_media")
    media = 1.0 if (not _missing(has_media) and bool(has_media) and has_media != 0) else 0.4
    corr = post.get("corroboration")
    corr = 0.0 if _missing(corr) else min(float(corr) / 3, 1.0)
    dup = post.get("duplicate_of")
    originality = 1.0 if _missing(dup) else 0.0

    return {"source_trust": trust, "content_quality": max(q, 0.0), "specificity": spec,
            "media": media, "corroboration": corr, "originality": originality}


def score(post, weights=None):
    w = weights or DEFAULT_WEIGHTS
    f = extract_features(post)
    total = sum(w[k] * f[k] for k in FEATURES)
    reasons = [REASONS[k] for k in FEATURES if f[k] < 0.4]
    # Match backend Report: trustScore is 0-100; breakdown keys match pipeline.ts
    return {
        "trustScore": max(0, min(100, int(round(total * 100)))),
        "trustReasons": reasons,
        "trustBreakdown": {
            "sourceReliability": round(f["source_trust"] * 25),
            "corroboration": round(f["corroboration"] * 25),
            "officialMatch": 8,
            "media": round(f["media"] * 9),
            "text": round(f["content_quality"] * 10),
        },
    }


def add_corroboration(df, window_hours=6):
    """For each post: how many DIFFERENT authors reported the same category in the
    same city within +/- window_hours. Needs columns: author, city, category, created_at."""
    df = df.copy()
    if "category" not in df.columns and "event" in df.columns:
        df["category"] = df["event"]
    dt = pd.to_datetime(df["created_at"], utc=True, errors="coerce")
    window = pd.Timedelta(hours=window_hours)
    df["corroboration"] = 0
    for (city, category), g in df.groupby(["city", "category"]):
        if not city or category in ("other", "uncertain", ""):
            continue
        for idx in g.index:
            near = g[(g["author"] != g.at[idx, "author"]) & ((dt[g.index] - dt[idx]).abs() <= window)]
            df.at[idx, "corroboration"] = near["author"].nunique()
    return df


def fit_weights(df, verdict_col="admin_verdict"):
    """Learn weights from admin decisions. df needs the post fields used by
    extract_features plus verdict_col with values 'credible' / 'fake'."""
    from sklearn.linear_model import LogisticRegression

    X = np.array([[extract_features(r)[k] for k in FEATURES] for r in df.to_dict("records")])
    y = (df[verdict_col] == "credible").astype(int)
    lr = LogisticRegression(class_weight="balanced", max_iter=1000).fit(X, y)
    coefs = np.clip(lr.coef_[0], 0, None)           # keep weights non-negative
    coefs = coefs / coefs.sum() if coefs.sum() else np.array(list(DEFAULT_WEIGHTS.values()))
    return dict(zip(FEATURES, coefs.round(3)))
