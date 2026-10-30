"""
Real-time Mastodon collector using the streaming API (the instance's public timeline).
Posts that look like India weather reports are written to stream_in/ for the Spark job.

Setup: MASTODON_INSTANCE and MASTODON_TOKEN in your .env file.
  python stream_mastodon.py
Stop with Ctrl+C.
"""
import html
import re
import time

from mastodon import Mastodon, StreamListener

from common import env, is_india_related, is_weather_related, utc_now
from stream_sink import JsonlSink


def clean_html(raw_html):
    if not raw_html:
        return ""
    clean = re.sub(r"<[^>]+>", " ", str(raw_html))
    return html.unescape(clean).strip()


def build_row(status, text, tags, query="stream"):
    account = status.get("account") or {}
    media_attachments = status.get("media_attachments") or []
    urls = [m.get("url") for m in media_attachments if m.get("url")]
    kinds = sorted({m.get("type", "image") for m in media_attachments})
    handle = account.get("acct") or account.get("username") or "anonymous"
    created = status.get("created_at")
    created_str = created.isoformat() if hasattr(created, "isoformat") else str(created or "")
    acct_created = account.get("created_at")
    acct_created_str = acct_created.isoformat() if hasattr(acct_created, "isoformat") else str(acct_created or "")

    return {
        "source": "mastodon",
        "author": handle,
        "display_name": account.get("display_name") or "",
        "text": text,
        "created_at": created_str,
        "language": status.get("language") or "",
        "hashtags": ",".join(tags),
        "has_media": int(bool(urls)),
        "media_types": ",".join(kinds),
        "media_urls": " | ".join(urls),
        "likes": status.get("favourites_count") or 0,
        "reposts": status.get("reblogs_count") or 0,
        "replies": status.get("replies_count") or 0,
        "account_created_at": acct_created_str,
        "followers": account.get("followers_count"),
        "following": account.get("following_count"),
        "account_posts": account.get("statuses_count"),
        "lat": None,
        "lon": None,
        "matched_query": query,
        "uri": status.get("uri") or status.get("url") or "",
        "url": status.get("url") or status.get("uri") or "",
        "collected_at": utc_now().isoformat(),
    }


class WeatherListener(StreamListener):
    def __init__(self, sink):
        super().__init__()
        self.sink = sink
        self.seen = set()
        self.scanned = 0
        self.kept = 0
        self.last_report = time.time()

    def on_update(self, status):
        try:
            self.scanned += 1
            text = clean_html(status.get("content") or "")
            tags = [t["name"] for t in status.get("tags") or []]
            full = text + " " + " ".join("#" + t for t in tags)   # hashtags count as signal too
            key = status.get("uri") or status.get("url")
            if key and key not in self.seen and is_weather_related(full) and is_india_related(full):
                self.seen.add(key)
                row = build_row(status, text, tags, "stream")
                row["matched_query"] = "public_stream"
                self.sink.write(row)
                self.kept += 1
                print(f"+ {status['account']['acct']}: {text[:90]!r}")
                if len(self.seen) > 100_000:
                    self.seen.clear()
        except Exception as e:                    # one bad post must not stop the stream
            print("Skipped a post:", e)
        if time.time() - self.last_report >= 60:
            print(f"[{time.strftime('%H:%M:%S')}] scanned {self.scanned} posts, kept {self.kept}")
            self.last_report = time.time()


def main():
    api = Mastodon(access_token=env("MASTODON_TOKEN"), api_base_url=env("MASTODON_INSTANCE"))
    sink = JsonlSink(prefix="mastodon")
    listener = WeatherListener(sink)
    backoff = 1
    try:
        while True:
            try:
                print("Connected to Mastodon stream")
                api.stream_public(listener)       # blocks until the connection drops
                backoff = 1
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"Stream dropped ({type(e).__name__}: {e}); retrying in {backoff}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        sink.close()


if __name__ == "__main__":
    main()
