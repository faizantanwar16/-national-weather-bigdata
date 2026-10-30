"""
Live Bluesky Jetstream stream collector.
Entrypoint for the live streaming demo.
"""
import argparse
import asyncio

from bluesky_data import run

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real-time India weather posts from Bluesky Jetstream")
    parser.add_argument("--replay-hours", type=float, default=0,
                        help="on first start, catch up on this many past hours")
    args = parser.parse_args()
    try:
        asyncio.run(run(args.replay_hours))
    except KeyboardInterrupt:
        print("\nStopped.")
