"""Shared settings and helpers for all data collectors."""
import argparse
import os
import re
import sys
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

from geotagger import STATE_CENTROIDS

load_dotenv()   # reads API keys from the .env file in this folder

# ---------------------------------------------------------------------------
# Cities polled by the weather-API collectors: name -> (state, lat, lon).
# Add or remove cities freely.
# ---------------------------------------------------------------------------
INDIA_CITIES = {
    "Mumbai": ("Maharashtra", 19.0760, 72.8777), "Delhi": ("Delhi", 28.6139, 77.2090),
    "Bengaluru": ("Karnataka", 12.9716, 77.5946), "Hyderabad": ("Telangana", 17.3850, 78.4867),
    "Chennai": ("Tamil Nadu", 13.0827, 80.2707), "Kolkata": ("West Bengal", 22.5726, 88.3639),
    "Pune": ("Maharashtra", 18.5204, 73.8567), "Ahmedabad": ("Gujarat", 23.0225, 72.5714),
    "Jaipur": ("Rajasthan", 26.9124, 75.7873), "Lucknow": ("Uttar Pradesh", 26.8467, 80.9462),
    "Kanpur": ("Uttar Pradesh", 26.4499, 80.3319), "Nagpur": ("Maharashtra", 21.1458, 79.0882),
    "Indore": ("Madhya Pradesh", 22.7196, 75.8577), "Bhopal": ("Madhya Pradesh", 23.2599, 77.4126),
    "Patna": ("Bihar", 25.5941, 85.1376), "Vadodara": ("Gujarat", 22.3072, 73.1812),
    "Surat": ("Gujarat", 21.1702, 72.8311), "Rajkot": ("Gujarat", 22.3039, 70.8022),
    "Visakhapatnam": ("Andhra Pradesh", 17.6868, 83.2185), "Vijayawada": ("Andhra Pradesh", 16.5062, 80.6480),
    "Coimbatore": ("Tamil Nadu", 11.0168, 76.9558), "Madurai": ("Tamil Nadu", 9.9252, 78.1198),
    "Kochi": ("Kerala", 9.9312, 76.2673), "Thiruvananthapuram": ("Kerala", 8.5241, 76.9366),
    "Mangaluru": ("Karnataka", 12.9141, 74.8560), "Chandigarh": ("Chandigarh", 30.7333, 76.7794),
    "Amritsar": ("Punjab", 31.6340, 74.8723), "Ludhiana": ("Punjab", 30.9010, 75.8573),
    "Guwahati": ("Assam", 26.1445, 91.7362), "Bhubaneswar": ("Odisha", 20.2961, 85.8245),
    "Ranchi": ("Jharkhand", 23.3441, 85.3096), "Raipur": ("Chhattisgarh", 21.2514, 81.6296),
    "Dehradun": ("Uttarakhand", 30.3165, 78.0322), "Shimla": ("Himachal Pradesh", 31.1048, 77.1734),
    "Srinagar": ("Jammu and Kashmir", 34.0837, 74.7973), "Jammu": ("Jammu and Kashmir", 32.7266, 74.8570),
    "Varanasi": ("Uttar Pradesh", 25.3176, 82.9739), "Agra": ("Uttar Pradesh", 27.1767, 78.0081),
    "Nashik": ("Maharashtra", 19.9975, 73.7898), "Jodhpur": ("Rajasthan", 26.2389, 73.0243),
    "Udaipur": ("Rajasthan", 24.5854, 73.7125), "Panaji": ("Goa", 15.4909, 73.8278),
    "Imphal": ("Manipur", 24.8170, 93.9368), "Shillong": ("Meghalaya", 25.5788, 91.8933),
    "Gangtok": ("Sikkim", 27.3389, 88.6065), "Aizawl": ("Mizoram", 23.7271, 92.7176),
    "Itanagar": ("Arunachal Pradesh", 27.0844, 93.6053), "Kohima": ("Nagaland", 25.6747, 94.1086),
    "Agartala": ("Tripura", 23.8315, 91.2868), "Puducherry": ("Puducherry", 11.9416, 79.8083),
    "Port Blair": ("Andaman and Nicobar Islands", 11.6234, 92.7265),
}

# ---------------------------------------------------------------------------
# What to search for on social media
# ---------------------------------------------------------------------------
INDIA_HASHTAGS = [
    "IMD", "IndiaWeather", "IndiaRains", "IndianMonsoon", "MumbaiRains", "DelhiRains",
    "ChennaiRains", "BengaluruRains", "HyderabadRains", "KolkataRains", "PuneRains",
    "KeralaRains", "KeralaFloods", "AssamFloods", "DelhiWeather", "MumbaiWeather", "DelhiFog",
]
GENERIC_HASHTAGS = [   # worldwide tags; the India filter below removes foreign posts
    "rain", "flood", "floods", "heatwave", "fog", "monsoon", "thunderstorm", "duststorm",
    "cyclone", "weather", "waterlogging", "cloudburst", "hailstorm", "lightning",
]
HINGLISH_TERMS = ["baarish", "barish", "kohra", "garmi", "andhi", "toofan"]

# Bluesky: plain keywords, no hashtags. These return posts from all over the world,
# so the India filter further down does the narrowing.
BLUESKY_KEYWORDS = [
    "rain", "heavy rain", "rainfall", "monsoon", "downpour", "thunderstorm", "lightning",
    "hailstorm", "cloudburst", "flood", "flooding", "waterlogging", "heatwave", "heat wave",
    "scorching", "fog", "dense fog", "dust storm", "strong winds", "cyclone", "storm",
    "weather", "weather alert", "IMD",
]
# City + weather word: precise, so almost every hit is a real local report.
# Delete this line's contents (set to []) if you only want the general keywords.
BLUESKY_CITY_QUERIES = [f"{city} {word}" for city in INDIA_CITIES
                        for word in ("rain", "flood", "weather")]
BLUESKY_QUERIES = BLUESKY_KEYWORDS + HINGLISH_TERMS + BLUESKY_CITY_QUERIES
# Mastodon hashtag timelines take one tag at a time, no spaces, case-insensitive
MASTODON_HASHTAGS = list(dict.fromkeys(t.lower() for t in INDIA_HASHTAGS + GENERIC_HASHTAGS))

# ---------------------------------------------------------------------------
# Relevance filters (cheap keyword checks; the ML models do the fine work later)
# ---------------------------------------------------------------------------
WEATHER_RE = re.compile(
    r"(?<!\w)(rain|rains|rainfall|rainy|drizzle|showers?|downpour|monsoon|thunder|thunderstorms?|"
    r"lightning|hail|hailstorm|cloudburst|flood|floods|flooded|flooding|waterlogging|waterlogged|"
    r"heatwave|heat wave|heatstroke|scorching|sweltering|fog|foggy|dust storm|duststorm|sandstorm|"
    r"gusty|gusts?|strong winds?|cyclone|storm|weather|forecast|temperature|alert|warning|"
    r"barish|baarish|kohra|garmi|andhi|toofan|baadh)(?!\w)", re.IGNORECASE)
HASHTAG_ROOTS = ("rain", "flood", "heat", "fog", "storm", "weather", "monsoon",
                 "cyclone", "lightning", "hail", "cloudburst", "waterlog")

_EXTRA_CUES = ["india", "indian", "bharat", "imd", "bombay", "calcutta", "madras", "bangalore",
               "gurgaon", "gurugram", "noida", "ghaziabad", "faridabad", "thane", "navi mumbai",
               "new delhi", "konkan", "vidarbha", "marathwada", "rayalaseema", "kashmir"]
_CUES = sorted({c.lower() for c in INDIA_CITIES} | {s.lower() for s in STATE_CENTROIDS}
               | set(_EXTRA_CUES) | set(HINGLISH_TERMS), key=len, reverse=True)
INDIA_RE = re.compile(r"(?<!\w)(" + "|".join(map(re.escape, _CUES)) + r")(?!\w)", re.IGNORECASE)
# hashtags like #MumbaiRains or #IMDAlert have no word break, so match by prefix
_PREFIX_CUES = [c for c in _CUES if len(c) >= 5 and " " not in c] + ["imd"]
NON_INDIA_RE = re.compile(
    r"(?<!\w)(pakistan|lahore|karachi|islamabad|bangladesh|dhaka|nepal|kathmandu|"
    r"sri lanka|colombo|bhutan|myanmar)(?!\w)", re.IGNORECASE)
EXPLICIT_INDIA_RE = re.compile(r"(?<!\w)(india|indian|imd)(?!\w)", re.IGNORECASE)


def is_weather_related(text):
    t = str(text)
    if WEATHER_RE.search(t):
        return True
    tags = re.findall(r"#(\w+)", t.lower())
    return any(root in tag for tag in tags for root in HASHTAG_ROOTS)


def is_india_related(text):
    t = str(text)
    if NON_INDIA_RE.search(t) and not EXPLICIT_INDIA_RE.search(t):
        return False
    if INDIA_RE.search(t):
        return True
    tags = re.findall(r"#(\w+)", t.lower())
    return any(tag.startswith(c) for tag in tags for c in _PREFIX_CUES)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def env(name):
    value = os.getenv(name, "").strip()
    if not value:
        sys.exit(f"Missing {name}. Add it to your .env file (see .env.example).")
    return value


def utc_now():
    return pd.Timestamp.now(tz="UTC")


def parse_time(value):
    return pd.to_datetime(value, utc=True, errors="coerce")


def resolve_city(name):
    """Look a city up in INDIA_CITIES (case-insensitive). Returns (city, state, lat, lon) or None."""
    key = str(name).strip().lower()
    for city, (state, lat, lon) in INDIA_CITIES.items():
        if city.lower() == key:
            return city, state, lat, lon
    return None


def save_merged(path, rows, key):
    """Append rows to a CSV, skipping ones already stored. key = column name(s) that identify a row.
    Returns how many new rows were added."""
    if not rows:
        return 0
    new = pd.DataFrame(rows)
    before = 0
    if Path(path).exists():
        old = pd.read_csv(path)
        before = len(old)
        new = pd.concat([old, new], ignore_index=True)
    new = new.drop_duplicates(subset=key, keep="first")
    new.to_csv(path, index=False)
    return len(new) - before


def cli(job, description, add_args=None):
    """Run job(args) once, or repeatedly with --every N (minutes)."""
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--every", type=float, default=0,
                        help="repeat every N minutes (default: run once)")
    if add_args:
        add_args(parser)
    args = parser.parse_args()
    try:
        while True:
            try:
                job(args)
            except Exception as e:           # keep a long-running loop alive
                print("Run failed:", e)
            if not args.every:
                break
            print(f"Sleeping {args.every:g} min... (Ctrl+C to stop)")
            time.sleep(args.every * 60)
    except KeyboardInterrupt:
        print("\nStopped.")