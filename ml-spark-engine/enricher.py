"""
Enrichment engine: classify, geotag, de-duplicate and score credibility.

One Enricher object is used by both:
  - pipeline.py      (batch: whole CSV files at once)
  - spark_stream.py  (real time: one micro-batch at a time)

It keeps state between calls (already-seen posts, duplicate index, recent posts for
corroboration), so call process() repeatedly on the same object when streaming.
"""
import uuid
from collections import OrderedDict

import pandas as pd

from classifier import MODEL_PATH, EventClassifier, weak_label
from credibility import add_corroboration, score
from geotagger import GeoTagger
from report_mapping import MIN_CLASSIFIER_CONF, canonicalize_category


class KeywordClassifier:
    """Fallback until you have trained a model: simple keyword rules."""

    def predict(self, texts):
        return [(canonicalize_category(weak_label(t) or "other"), 0.5) for t in texts]


def _default_classifier():
    if MODEL_PATH.exists():
        return EventClassifier()
    print("No trained model found - using keyword rules for category labels.")
    return KeywordClassifier()


class Enricher:
    def __init__(self, classifier=None, geotagger=None, dedup=None,
                 history_hours=6, max_seen=200_000):
        self.classifier = classifier or _default_classifier()
        self.geotagger = geotagger or GeoTagger()
        if dedup is None:
            from dedup import DuplicateDetector   # imported here so tests can inject a fake
            dedup = DuplicateDetector()
        self.dedup = dedup
        self.history_hours = history_hours
        self.history = pd.DataFrame(columns=["author", "city", "category", "created_at"])
        self.seen = OrderedDict()          # post ids already processed
        self.max_seen = max_seen

    # ------------------------------------------------------------------
    def _remember(self, ids):
        for i in ids:
            self.seen[i] = None
        while len(self.seen) > self.max_seen:
            self.seen.popitem(last=False)

    def _prune_history(self, combo):
        dt = pd.to_datetime(combo["created_at"], utc=True, errors="coerce")
        cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(hours=self.history_hours)
        self.history = combo[dt >= cutoff].reset_index(drop=True)

    # ------------------------------------------------------------------
    def process(self, df):
        """Takes raw collector rows, returns them enriched. Posts seen before are dropped."""
        df = df.copy().reset_index(drop=True)
        if df.empty:
            return df

        # one id per post: Bluesky/Mastodon 'uri', falling back to 'url'
        blank = pd.Series([None] * len(df), index=df.index)
        post_id = (df["uri"] if "uri" in df else blank).fillna(df["url"] if "url" in df else blank)
        df["reportId"] = [p if isinstance(p, str) and p else uuid.uuid4().hex for p in post_id]
        df["post_id"] = df["reportId"]  # alias kept for the in-memory duplicate index

        # drop posts we already handled (stream replays, overlapping collection runs)
        df = df[[p not in self.seen for p in df["reportId"]]].drop_duplicates(subset="reportId")
        if df.empty:
            return df.reset_index(drop=True)
        self._remember(df["reportId"])

        # oldest first, so the earliest copy of a story is treated as the original
        dt = pd.to_datetime(df["created_at"], utc=True, errors="coerce")
        df = df.assign(_dt=dt).sort_values("_dt").drop(columns="_dt").reset_index(drop=True)
        df["text"] = df["text"].fillna("").astype(str)

        # 1. event classification (backend field names)
        preds = self.classifier.predict(df["text"].tolist())
        df["category"] = [canonicalize_category(p[0]) for p in preds]
        df["categoryConfidence"] = [p[1] for p in preds]
        df["lowConfidence"] = [
            conf < MIN_CLASSIFIER_CONF or cat == "other"
            for cat, conf in zip(df["category"], df["categoryConfidence"])
        ]
        df["rawText"] = df["text"]

        # 2. geotagging. A post that already has GPS keeps it.
        geo_rows = []
        for r in df.itertuples():
            lat, lon = getattr(r, "lat", None), getattr(r, "lon", None)
            gps = (float(lat), float(lon)) if pd.notna(lat) and pd.notna(lon) else None
            geo_rows.append(self.geotagger.tag(r.text, gps=gps))
        geo = pd.DataFrame(geo_rows, index=df.index)
        df = df.drop(columns=[c for c in geo.columns if c in df.columns]).join(geo)

        # 3. duplicates
        res = [self.dedup.check_and_add(r.reportId, r.text) for r in df.itertuples()]
        df["duplicate_of"] = [r[0] for r in res]
        df["duplicate_reason"] = [r[1] for r in res]

        # 4. corroboration (other authors, same city + event, nearby in time), then credibility.
        #    Recent posts from earlier micro-batches count too.
        batch = df[["author", "city", "category", "created_at"]]
        combo = add_corroboration(pd.concat([self.history, batch], ignore_index=True))
        df["corroboration"] = combo["corroboration"].iloc[len(self.history):].to_numpy()
        self._prune_history(combo.drop(columns="corroboration"))

        cred = pd.DataFrame([score(r) for r in df.to_dict("records")], index=df.index)
        df = df.join(cred)
        df["processed_at"] = pd.Timestamp.now(tz="UTC").isoformat()
        df["verificationStatus"] = "needs_review"
        return df
