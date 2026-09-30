"""
Train and evaluate the weather event classifier.

Usage:
    python train_event_classifier.py
    python train_event_classifier.py --data ../sample_data/sample_labeled_posts.csv --model nb
    python train_event_classifier.py --model svm

Notes:
- Default model is Multinomial Naive Bayes: it works fine even on the tiny
  40-row sample dataset here, and gives predict_proba() out of the box for
  free (useful later as a confidence score in the pipeline).
- Switch to --model svm once the real ~300-500 row labeled dataset exists;
  LinearSVC generally edges out NB with more data, but needs enough samples
  per class for cross-validated probability calibration to be meaningful.
"""

import argparse
import json
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import ConfusionMatrixDisplay, classification_report
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.svm import LinearSVC

from text_utils import clean_text

THIS_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_PATH = THIS_DIR.parent / "sample_data" / "sample_labeled_posts.csv"
DEFAULT_MODEL_DIR = THIS_DIR.parent / "models"


def load_dataset(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    required_cols = {"text", "label"}
    if not required_cols.issubset(df.columns):
        raise ValueError(f"CSV must contain columns {required_cols}, got {list(df.columns)}")

    df = df.dropna(subset=["text", "label"]).copy()
    df["clean_text"] = df["text"].apply(clean_text)
    df = df[df["clean_text"].str.len() > 0]
    return df


def build_model(model_name: str, min_class_count: int):
    if model_name == "nb":
        return MultinomialNB()

    if model_name == "svm":
        # CalibratedClassifierCV needs at least `cv` samples in the smallest
        # class. Fall back to fewer folds automatically on small datasets
        # instead of crashing on the sample data.
        cv_folds = min(5, min_class_count)
        if cv_folds < 2:
            print(
                "Warning: not enough samples per class to calibrate SVM "
                "probabilities. Falling back to plain LinearSVC (no "
                "predict_proba)."
            )
            return LinearSVC()
        return CalibratedClassifierCV(LinearSVC(), cv=cv_folds)

    raise ValueError(f"Unknown model type: {model_name}")


def main():
    parser = argparse.ArgumentParser(description="Train the weather event classifier")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_PATH,
                         help="Path to labeled CSV with 'text' and 'label' columns")
    parser.add_argument("--model", choices=["nb", "svm"], default="nb",
                         help="Model type: 'nb' (Naive Bayes) or 'svm' (Linear SVM)")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_MODEL_DIR,
                         help="Directory to save the trained model + vectorizer")
    parser.add_argument("--test-size", type=float, default=0.2,
                         help="Fraction of data held out for evaluation")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading dataset from {args.data} ...")
    df = load_dataset(args.data)
    print(f"Loaded {len(df)} labeled posts across {df['label'].nunique()} classes.")
    print(df["label"].value_counts(), "\n")

    class_counts = df["label"].value_counts()
    min_class_count = int(class_counts.min())

    if min_class_count < 2:
        raise ValueError(
            "At least one class has fewer than 2 examples — can't do a "
            "stratified train/test split. Label more examples for that "
            "class before training."
        )

    X_train_text, X_test_text, y_train, y_test = train_test_split(
        df["clean_text"], df["label"],
        test_size=args.test_size,
        random_state=args.seed,
        stratify=df["label"],
    )

    print(f"Train size: {len(X_train_text)}, Test size: {len(X_test_text)}\n")

    # sublinear_tf + ngram_range=(1,2) — bigrams matter here because "heavy
    # rain" and "light rain" carry different meaning that unigrams alone lose.
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        max_features=5000,
        sublinear_tf=True,
        min_df=1,
    )
    X_train = vectorizer.fit_transform(X_train_text)
    X_test = vectorizer.transform(X_test_text)

    model = build_model(args.model, min_class_count)
    print(f"Training {type(model).__name__} ...")
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)

    print("\n=== Classification Report ===")
    report_str = classification_report(y_test, y_pred, zero_division=0)
    print(report_str)

    report_dict = classification_report(y_test, y_pred, zero_division=0, output_dict=True)

    # --- Confusion matrix, saved as an image for the report/slide ---
    labels_sorted = sorted(df["label"].unique())
    fig, ax = plt.subplots(figsize=(7, 6))
    ConfusionMatrixDisplay.from_predictions(
        y_test, y_pred, labels=labels_sorted, xticks_rotation=45, ax=ax, colorbar=False
    )
    plt.tight_layout()
    cm_path = args.out_dir / "confusion_matrix.png"
    plt.savefig(cm_path, dpi=150)
    print(f"Saved confusion matrix to {cm_path}")

    # --- Persist model artifacts ---
    joblib.dump(model, args.out_dir / "event_classifier.joblib")
    joblib.dump(vectorizer, args.out_dir / "tfidf_vectorizer.joblib")
    with open(args.out_dir / "labels.json", "w") as f:
        json.dump(labels_sorted, f, indent=2)
    with open(args.out_dir / "metrics.json", "w") as f:
        json.dump(report_dict, f, indent=2)

    print(f"\nSaved model, vectorizer, labels and metrics to {args.out_dir}")


if __name__ == "__main__":
    main()
