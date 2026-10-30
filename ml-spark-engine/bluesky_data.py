"""
Real-time Bluesky collector using Jetstream, Bluesky's public WebSocket feed of every new post.
No login or API key needed. Posts that look like India weather reports are written to
stream_in/, where the Spark job picks them up within seconds.

  python stream_bluesky.py                   # live from now on
  python stream_bluesky.py --replay-hours 6  # first catch up on the last 6 hours (Jetstream
                                             # only keeps a limited window of past events)
Stop with Ctrl+C. Restarting resumes where it left off (cursor saved in stream_state/).

Note: this reads every Bluesky post and filters locally, so expect noticeable network use.
"""
import argparse
import asyncio
import json
import re
import time
from pathlib import Path

import requests
import websockets

from common import is_india_related, is_weather_related, utc_now
from stream_sink import JsonlSink

JETSTREAM = "wss://jetstream2.us-east.bsky.network/subscribe"
PROFILE_URL = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile"
CURSOR_FILE = Path("stream_state/bluesky_cursor.txt")
POST_TYPE = "app.bsky.feed.post"


def parse_event(msg):
    """Jetstream message -> small dict for a newly created post, else None."""
    if msg.get("kind") != "commit":
        return None
    commit = msg.get("commit") or {}
    if commit.get("operation") != "create" or commit.get("collection") != POST_TYPE:
        return None
    rec = commit.get("record") or {}
    text = rec.get("text") or ""
    if not text or not rec.get("createdAt"):
        return None
    did, rkey = msg["did"], commit["rkey"]
    return {"did": did, "rkey": rkey, "uri": f"at://{did}/{POST_TYPE}/{rkey}", "text": text,
            "created_at": rec["createdAt"], "langs": rec.get("langs") or [], "embed": rec.get("embed")}


def media_from_embed(did, embed):
    """Image / video URLs from a post's embed (images are built from their blob ids)."""
    embed = embed or {}
    media = embed.get("media") or embed          # photos can be nested inside a quote post
    urls, kinds = [], set()
    for img in media.get("images") or []:
        cid = ((img.get("image") or {}).get("ref") or {}).get("$link")
        if cid:
            urls.append(f"https://cdn.bsky.app/img/feed_fullsize/plain/{did}/{cid}@jpeg")
            kinds.add("image")
    cid = ((media.get("video") or {}).get("ref") or {}).get("$link")
    if cid:
        urls.append(f"https://video.bsky.app/watch/{did}/{cid}/playlist.m3u8")
        kinds.add("video")
    return urls, sorted(kinds)


_profiles = {}


def fetch_profile(did):
    """Handle, follower count, account age. Cached; falls back to the bare DID if the call fails."""
    if did not in _profiles:
        try:
            r = requests.get(PROFILE_URL, params={"actor": did}, timeout=10)
            r.raise_for_status()
            _profiles[did] = r.json()
        except Exception:
            _profiles[did] = {}
    return _profiles[did]


def build_row(ev, profile):
    """Same columns as the batch collector in bluesky_data.py."""
    urls, kinds = media_from_embed(ev["did"], ev["embed"])
    handle = profile.get("handle") or ev["did"]
    return {
        "source": "bluesky",
        "author": handle,
        "display_name": profile.get("displayName") or "",
        "text": ev["text"],
        "created_at": ev["created_at"],
        "language": ",".join(ev["langs"]),
        "hashtags": ",".join(re.findall(r"#(\w+)", ev["text"])),
        "has_media": int(bool(urls)),
        "media_types": ",".join(kinds),
        "media_urls": " | ".join(urls),
        "likes": 0, "reposts": 0, "replies": 0,       # a brand-new post has no engagement yet
        "account_created_at": profile.get("createdAt"),
        "followers": profile.get("followersCount"),
        "following": profile.get("followsCount"),
        "account_posts": profile.get("postsCount"),
        "lat": None, "lon": None,
        "matched_query": "jetstream",
        "uri": ev["uri"],
        "url": f"https://bsky.app/profile/{handle}/post/{ev['rkey']}",
        "collected_at": utc_now().isoformat(),
    }


def load_cursor():
    try:
        return int(CURSOR_FILE.read_text().strip())
    except (OSError, ValueError):
        return None


def save_cursor(value):
    CURSOR_FILE.parent.mkdir(parents=True, exist_ok=True)
    CURSOR_FILE.write_text(str(value))


async def run(replay_hours):
    sink = JsonlSink(prefix="bluesky")
    cursor = load_cursor()
    if cursor is None and replay_hours:
        cursor = int((time.time() - replay_hours * 3600) * 1_000_000)
    seen, scanned, kept = set(), 0, 0
    last_us, last_report, last_save = cursor, time.time(), time.time()
    backoff = 1

    while True:
        url = f"{JETSTREAM}?wantedCollections={POST_TYPE}"
        if last_us:
            url += f"&cursor={last_us - 5_000_000}"       # rewind 5 s so nothing is missed
        try:
            async with websockets.connect(url, max_size=None, ping_interval=20) as ws:
                print("Connected to Jetstream" + (" (resuming)" if last_us else ""))
                backoff = 1
                async for raw in ws:
                    msg = json.loads(raw)
                    last_us = msg.get("time_us") or last_us
                    ev = parse_event(msg)
                    if ev:
                        scanned += 1
                        if (is_weather_related(ev["text"]) and is_india_related(ev["text"])
                                and ev["uri"] not in seen):
                            seen.add(ev["uri"])
                            profile = await asyncio.to_thread(fetch_profile, ev["did"])
                            sink.write(build_row(ev, profile))
                            kept += 1
                            print(f"+ {profile.get('handle') or ev['did']}: {ev['text'][:90]!r}")
                            if len(seen) > 100_000:
                                seen.clear()
                    now = time.time()
                    if now - last_report >= 60:
                        print(f"[{time.strftime('%H:%M:%S')}] scanned {scanned} posts, kept {kept}")
                        last_report = now
                    if now - last_save >= 10 and last_us:
                        save_cursor(last_us)
                        last_save = now
        except (websockets.exceptions.ConnectionClosed, OSError, asyncio.TimeoutError) as e:
            print(f"Connection lost ({type(e).__name__}); retrying in {backoff}s")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
        finally:
            if last_us:
                save_cursor(last_us)
            sink.flush()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real-time India weather posts from Bluesky Jetstream")
    parser.add_argument("--replay-hours", type=float, default=0,
                        help="on first start, catch up on this many past hours")
    args = parser.parse_args()
    try:
        asyncio.run(run(args.replay_hours))
    except KeyboardInterrupt:
        print("\nStopped.")