"""
Shared text preprocessing for the event classifier.

Kept deliberately light — this is for informal, code-mixed social media
text (English + Hindi in Latin script), not clean formal prose. Aggressive
cleaning (e.g. stripping all non-ASCII) would destroy signal in transliterated
Hindi words like "baarish" or "aandhi", so we keep it minimal on purpose.
"""

import re

URL_PATTERN = re.compile(r"https?://\S+|www\.\S+")
MENTION_PATTERN = re.compile(r"@\w+")
NON_ALNUM_PATTERN = re.compile(r"[^a-zA-Z0-9#\s]")
MULTI_SPACE_PATTERN = re.compile(r"\s+")


def clean_text(text: str) -> str:
    """
    Normalize a raw post for TF-IDF vectorization.

    Steps:
    - lowercase
    - strip URLs and @mentions (no signal for event classification)
    - turn '#IMD' into 'imd' so hashtag words still count as normal tokens
    - drop punctuation except '#' (needed for the step above) and word chars
    - collapse whitespace
    """
    if not isinstance(text, str):
        return ""

    text = text.lower()
    text = URL_PATTERN.sub(" ", text)
    text = MENTION_PATTERN.sub(" ", text)
    text = text.replace("#", " ")  # '#imd' -> ' imd' after lowercasing above
    text = NON_ALNUM_PATTERN.sub(" ", text)
    text = MULTI_SPACE_PATTERN.sub(" ", text).strip()
    return text
