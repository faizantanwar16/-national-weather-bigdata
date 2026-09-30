"""
Load the trained event classifier and predict on new post text.

This is the module the pipeline function (step 8 of the ML build order)
will import — it's kept separate from train_event_classifier.py so the
pipeline doesn't need scikit-learn's training-only dependencies at inference
time, and so this same interface still works once the model is swapped for
the SVM/DistilBERT upgrade later.

Usage (standalone test):
    python predict.py "Heavy rainfall in Pune since morning #IMD"
"""

import sys
from pathlib import Path

import joblib

from text_utils import clean_text

THIS_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL_DIR = THIS_DIR.parent / "models"


class EventClassifier:
    def __init__(self, model_dir: Path = DEFAULT_MODEL_DIR):
        model_path = model_dir / "event_classifier.joblib"
        vectorizer_path = model_dir / "tfidf_vectorizer.joblib"

        if not model_path.exists() or not vectorizer_path.exists():
            raise FileNotFoundError(
                f"No trained model found in {model_dir}. "
                "Run train_event_classifier.py first."
            )

        self.model = joblib.load(model_path)
        self.vectorizer = joblib.load(vectorizer_path)

    def predict(self, text: str) -> dict:
        """
        Classify a single post.

        Returns:
            {
                "label": "rainfall",
                "confidence": 0.83,   # None if the underlying model has no predict_proba
            }
        """
        cleaned = clean_text(text)
        features = self.vectorizer.transform([cleaned])

        label = self.model.predict(features)[0]

        confidence = None
        if hasattr(self.model, "predict_proba"):
            probabilities = self.model.predict_proba(features)[0]
            confidence = float(max(probabilities))

        return {"label": label, "confidence": confidence}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python predict.py "some post text"')
        sys.exit(1)

    input_text = " ".join(sys.argv[1:])
    classifier = EventClassifier()
    result = classifier.predict(input_text)
    print(f"Text:       {input_text}")
    print(f"Label:      {result['label']}")
    print(f"Confidence: {result['confidence']}")
