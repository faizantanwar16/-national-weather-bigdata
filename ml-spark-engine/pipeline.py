"""
Batch mode: run the ML steps over the CSVs written by the collectors.

  python pipeline.py bluesky_posts.csv mastodon_posts.csv
  python pipeline.py bluesky_posts.csv mastodon_posts.csv --db    # also store in MongoDB

Output: enriched_posts.csv  (category, location, duplicate flag, trustScore)
For real-time processing use spark_stream.py instead; both share enricher.py.
"""
import sys
from pathlib import Path

import pandas as pd

from enricher import Enricher


def main(paths, to_db=False, out="enriched_posts.csv"):
    frames = []
    for p in paths:
        d = pd.read_csv(p)
        if "source" not in d:
            d["source"] = Path(p).stem.split("_")[0]
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    if df.empty:
        print("No posts to process.")
        return

    df = Enricher().process(df)
    df.to_csv(out, index=False)
    print(f"Saved {len(df)} enriched posts to {out}")
    print(df["category"].value_counts().to_string())

    if to_db:
        import db
        print(f"Stored {db.insert_posts(df)} new reports in MongoDB")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
    else:
        main(args, to_db="--db" in sys.argv)