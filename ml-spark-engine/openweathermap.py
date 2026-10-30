"""
OpenWeatherMap collector: current weather for Indian cities -> weather_observations.csv

Setup: put OPENWEATHER_API_KEY in your .env file.
  python openweathermap.py                # every city in common.INDIA_CITIES
  python openweathermap.py --city Pune    # one Indian city (any name, not only the list)
  python openweathermap.py --every 30     # repeat every 30 minutes (Ctrl+C to stop)
"""
import sys
import time
from datetime import datetime, timezone

import requests

from common import INDIA_CITIES, cli, env, resolve_city, save_merged

OUTPUT_FILE = "weather_observations.csv"
WEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"
GEO_URL = "https://api.openweathermap.org/geo/1.0/direct"


def geocode(key, name):
    """For cities that are not in INDIA_CITIES. ',IN' keeps the search inside India."""
    r = requests.get(GEO_URL, params={"q": f"{name},IN", "limit": 1, "appid": key}, timeout=15)
    r.raise_for_status()
    hits = r.json()
    if not hits:
        return None
    h = hits[0]
    return h["name"], h.get("state", ""), h["lat"], h["lon"]


def fetch_city(key, city, state, lat, lon):
    r = requests.get(WEATHER_URL, timeout=15,
                     params={"lat": lat, "lon": lon, "appid": key, "units": "metric"})
    r.raise_for_status()
    d = r.json()
    wind = d.get("wind", {})
    gust = wind.get("gust")
    vis = d.get("visibility")
    return {
        "source": "openweathermap",
        "city": city, "state": state, "lat": lat, "lon": lon,
        "observed_at": datetime.fromtimestamp(d["dt"], tz=timezone.utc).isoformat(),
        "temp_c": d["main"]["temp"],
        "feels_like_c": d["main"].get("feels_like"),
        "humidity": d["main"]["humidity"],
        "pressure_hpa": d["main"].get("pressure"),
        "wind_kph": round(wind.get("speed", 0) * 3.6, 1),     # m/s -> km/h
        "gust_kph": round(gust * 3.6, 1) if gust is not None else None,
        "visibility_km": round(vis / 1000, 2) if vis is not None else None,
        "rain_mm": d.get("rain", {}).get("1h"),               # rain in the last hour; blank = not reported
        "condition": d["weather"][0]["description"] if d.get("weather") else "",
    }


def add_args(parser):
    parser.add_argument("--city", help="fetch only this Indian city")


def collect(args):
    key = env("OPENWEATHER_API_KEY")
    if args.city:
        place = resolve_city(args.city) or geocode(key, args.city)
        if not place:
            sys.exit(f"Could not find '{args.city}' in India.")
        targets = [place]
    else:
        targets = [(c, s, la, lo) for c, (s, la, lo) in INDIA_CITIES.items()]

    rows = []
    for city, state, lat, lon in targets:
        try:
            row = fetch_city(key, city, state, lat, lon)
            rows.append(row)
            rain = "n/a" if row["rain_mm"] is None else f"{row['rain_mm']} mm"
            print(f"  {city}: {row['temp_c']:.1f} C, humidity {row['humidity']}%, "
                  f"rain {rain}, wind {row['wind_kph']} km/h")
        except (requests.RequestException, KeyError, ValueError) as e:
            print(f"  {city}: skipped ({e})")
        time.sleep(1.1)      # free plan allows 60 calls per minute

    added = save_merged(OUTPUT_FILE, rows, key=["source", "city", "observed_at"])
    print(f"Fetched {len(rows)} cities, {added} new rows -> {OUTPUT_FILE}")


if __name__ == "__main__":
    cli(collect, "Fetch current weather for Indian cities from OpenWeatherMap", add_args)