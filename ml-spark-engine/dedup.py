"""
Duplicate detector (no training): MinHash + LSH for text, perceptual hash for images.

Posts are never deleted. A duplicate gets duplicate_of = <id of the first post>,
so the admin panel can still show it and the credibility scorer can ignore it.
"""
import io
import re

import imagehash
from datasketch import MinHash, MinHashLSH
from PIL import Image


def normalize(text):
    t = str(text).lower()
    t = re.sub(r"^rt\s+@\w+:?\s*", "", t)       # old-style repost prefix
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"@\w+", " ", t)
    t = t.replace("#", " ")
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def minhash_of(norm_text, num_perm=128, k=3):
    """MinHash over word 3-grams ("shingles")."""
    words = norm_text.split()
    grams = [" ".join(words[i:i + k]) for i in range(max(1, len(words) - k + 1))]
    mh = MinHash(num_perm=num_perm)
    for g in grams:
        mh.update(g.encode("utf-8"))
    return mh


def image_phash(source):
    """source = file path or raw image bytes. Returns a perceptual hash."""
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    return imagehash.phash(Image.open(source).convert("RGB"))


class DuplicateDetector:
    def __init__(self, text_threshold=0.7, num_perm=128, min_words=6, image_max_distance=6):
        self.num_perm = num_perm
        self.min_words = min_words                  # very short posts: exact match only
        self.image_max_distance = image_max_distance  # Hamming distance, 0-64
        self.lsh = MinHashLSH(threshold=text_threshold, num_perm=num_perm)
        self.exact = {}      # normalized text -> post_id
        self.images = []     # (post_id, phash). Linear scan; fine up to ~100k images

    def check_and_add(self, post_id, text, image_hashes=None):
        """Returns (duplicate_of, reason). (None, None) means the post is new."""
        post_id = str(post_id)
        norm = normalize(text)

        if norm and norm in self.exact:
            return self.exact[norm], "exact_text"

        mh = None
        if len(norm.split()) >= self.min_words:
            mh = minhash_of(norm, self.num_perm)
            hits = self.lsh.query(mh)
            if hits:
                return hits[0], "near_text"

        for h in image_hashes or []:
            for other_id, other_h in self.images:
                if h - other_h <= self.image_max_distance:
                    return other_id, "image"

        # new post: register it
        if norm:
            self.exact[norm] = post_id
        if mh is not None and post_id not in self.lsh:
            self.lsh.insert(post_id, mh)
        self.images.extend((post_id, h) for h in image_hashes or [])
        return None, None
