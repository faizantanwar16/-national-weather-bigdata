"""
Weather event classifier: TF-IDF features + LinearSVC or Complement Naive Bayes.

Usage:
  python classifier.py sheet labeling_sheet.csv bluesky_posts.csv mastodon_posts.csv
      -> builds a CSV you label by hand (fill the empty "label" column)
  python classifier.py train labeling_sheet.csv
      -> compares Naive Bayes vs SVM with cross-validation, saves the winner
  python classifier.py predict "heavy rain and waterlogging in Pune"
"""
import re
import sys
from pathlib import Path

import joblib
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.svm import LinearSVC

from report_mapping import CATEGORIES, canonicalize_category, training_label

MODEL_PATH = Path("models/event_classifier.joblib")

# Must match backend EventCategory. Older names (flood, strong_wind) are mapped on output.
LABELS = list(CATEGORIES)

# Used only to PRE-FILL suggestions for hand labeling (includes some Hinglish).
KEYWORDS = {
    "rainfall": r"\b(rain|rains|rainfall|rainy|drizzle|shower|showers|downpour|monsoon|barish|baarish|barsat)\b",
    "thunderstorm": r"\b(thunderstorm|thunderstorms|thunder|lightning|hailstorm|hail|cloudburst)\b",
    "flooding": r"\b(flood|floods|flooded|flooding|waterlogging|waterlogged|inundated|submerged|baadh)\b",
    "heatwave": r"\b(heatwave|heat wave|heatstroke|heat stroke|sunstroke|scorching|sweltering|loo|garmi)\b",
    "fog": r"\b(fog|foggy|mist|kohra|low visibility|zero visibility)\b",
    "dust_storm": r"\b(dust\s?-?storm|sandstorm|andhi)\b",
    "strong_winds": r"\b(strong winds?|high winds?|gusty|gusts?|squall|windstorm|cyclone)\b",
}


def clean_text(text):
    text = str(text).lower()
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"@\w+", " ", text)
    text = re.sub(r"#(\w+)", r" \1 ", text)   # keep hashtag words, drop the '#'
    text = re.sub(r"[^\w\s]", " ", text)       # \w keeps Devanagari etc.
    return re.sub(r"\s+", " ", text).strip()


def weak_label(text):
    """Keyword guess. Returns '' when unclear or when two labels tie."""
    t = str(text).lower()
    hits = {lab: len(re.findall(p, t)) for lab, p in KEYWORDS.items()}
    hits = sorted(((k, v) for k, v in hits.items() if v), key=lambda kv: -kv[1])
    if not hits or (len(hits) > 1 and hits[0][1] == hits[1][1]):
        return ""
    return hits[0][0]


def make_labeling_sheet(out_csv, post_csvs):
    df = pd.concat([pd.read_csv(p) for p in post_csvs], ignore_index=True)
    df["clean"] = df["text"].map(clean_text)
    # Drop duplicates BEFORE labeling, or copies leak between train/test folds
    df = df[df["clean"] != ""].drop_duplicates(subset="clean")
    df["suggested_label"] = df["text"].map(weak_label)
    df["label"] = ""  # <-- fill this in by hand
    cols = ["text", "suggested_label", "label"]
    extra = [c for c in ("author", "created_at", "uri", "url") if c in df.columns]
    df[cols + extra].to_csv(out_csv, index=False)
    print(f"Wrote {len(df)} rows to {out_csv}. Fill the 'label' column using: {LABELS}")


def build_model(kind):
    features = FeatureUnion([
        ("word", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True)),
        # char n-grams handle typos, hashtags and Hinglish spellings
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5),
                                 sublinear_tf=True, min_df=2)),
    ])
    if kind == "svm":
        # calibration gives real probabilities, which we need for confidence scores
        clf = CalibratedClassifierCV(LinearSVC(C=1.0, class_weight="balanced"), cv=3)
    else:
        clf = ComplementNB(alpha=0.3)
    return Pipeline([("tfidf", features), ("clf", clf)])


def train(labeled_csv):
    df = pd.read_csv(labeled_csv)
    df["label"] = df["label"].map(training_label)
    df = df[df["label"].isin(LABELS)].copy()          # ignores blanks and typos
    df["clean"] = df["text"].map(clean_text)

    counts = df["label"].value_counts()
    print("Examples per class:\n" + counts.to_string() + "\n")
    keep = counts[counts >= 6].index
    if len(keep) < len(counts):
        print("Dropping classes with <6 examples:", sorted(set(counts.index) - set(keep)))
        df = df[df["label"].isin(keep)]
    X, y = df["clean"], df["label"]

    n_splits = min(5, int(counts[keep].min()))
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)

    results = {}
    for kind in ("nb", "svm"):
        pred = cross_val_predict(build_model(kind), X, y, cv=cv)
        results[kind] = (f1_score(y, pred, average="macro"), pred)
        print(f"{kind.upper():4s} macro-F1 ({n_splits}-fold CV): {results[kind][0]:.3f}")

    best = max(results, key=lambda k: results[k][0])
    print(f"\nWinner: {best.upper()}\n")
    print(classification_report(y, results[best][1]))

    final = build_model(best).fit(X, y)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(final, MODEL_PATH)
    print(f"Saved model to {MODEL_PATH}")


class EventClassifier:
    def __init__(self, path=MODEL_PATH, min_conf=0.45):
        self.model = joblib.load(path)
        self.min_conf = min_conf

    def predict(self, texts):
        """Returns [(category, confidence)]. Low confidence -> 'other' (admin review)."""
        proba = self.model.predict_proba([clean_text(t) for t in texts])
        out = []
        for p in proba:
            i = int(p.argmax())
            label = canonicalize_category(self.model.classes_[i])
            if p[i] < self.min_conf:
                label = "other"
            out.append((label, float(p[i])))
        return out


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "sheet":
        make_labeling_sheet(sys.argv[2], sys.argv[3:])
    elif cmd == "train":
        train(sys.argv[2])
    elif cmd == "predict":
        print(EventClassifier().predict([" ".join(sys.argv[2:])]))
    else:
        print(__doc__)
