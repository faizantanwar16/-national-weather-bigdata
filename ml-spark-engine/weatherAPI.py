"""
WeatherAPI.com collector: current weather for Indian cities -> weather_observations.csv

Setup: put WEATHERAPI_KEY in your .env file.
  python weatherAPI.py                # every city in common.INDIA_CITIES
  python weatherAPI.py --city Pune    # one Indian city (any name, not only the list)
  python weatherAPI.py --every 30     # repeat every 30 minutes (Ctrl+C to stop)

Writes to the same CSV as openweathermap.py, so both sources can be compared per city.
"""
import time
from datetime import datetime, timezone

import requests

from common import INDIA_CITIES, cli, env, resolve_city, save_merged

OUTPUT_FILE = "weather_observations.csv"
URL = "https://api.weatherapi.com/v1/current.json"


def fetch(key, query, city=None, state=None, lat=None, lon=None):
    r = requests.get(URL, params={"key": key, "q": query, "aqi": "no"}, timeout=15)
    data = r.json()
    if r.status_code != 200:
        raise RuntimeError(data.get("error", {}).get("message", f"HTTP {r.status_code}"))
    loc, cur = data["location"], data["current"]
    if loc.get("country") != "India":
        raise RuntimeError(f"'{query}' resolved outside India ({loc.get('country')})")
    return {
        "source": "weatherapi",
        "city": city or loc["name"],
        "state": state or loc.get("region", ""),
        "lat": lat if lat is not None else loc["lat"],
        "lon": lon if lon is not None else loc["lon"],
        "observed_at": datetime.fromtimestamp(cur["last_updated_epoch"], tz=timezone.utc).isoformat(),
        "temp_c": cur["temp_c"],
        "feels_like_c": cur.get("feelslike_c"),
        "humidity": cur["humidity"],
        "pressure_hpa": cur.get("pressure_mb"),
        "wind_kph": cur["wind_kph"],
        "gust_kph": cur.get("gust_kph"),
        "visibility_km": cur.get("vis_km"),
        "rain_mm": cur.get("precip_mm"),
        "condition": cur.get("condition", {}).get("text", ""),
    }


def add_args(parser):
    parser.add_argument("--city", help="fetch only this Indian city")


def collect(args):
    key = env("WEATHERAPI_KEY")
    if args.city:
        known = resolve_city(args.city)
        targets = [(known[0], known[1], known[2], known[3])] if known else [(None, None, None, None)]
        names = [args.city]
    else:
        targets = [(c, s, la, lo) for c, (s, la, lo) in INDIA_CITIES.items()]
        names = [c for c in INDIA_CITIES]

    rows = []
    for (city, state, lat, lon), name in zip(targets, names):
        # known cities are queried by coordinates; unknown ones by name
        query = f"{lat},{lon}" if lat is not None else f"{name}, India"
        try:
            row = fetch(key, query, city, state, lat, lon)
            rows.append(row)
            print(f"  {row['city']}: {row['temp_c']:.1f} C, humidity {row['humidity']}%, "
                  f"rain {row['rain_mm']} mm, wind {row['wind_kph']} km/h")
        except (requests.RequestException, RuntimeError, KeyError, ValueError) as e:
            print(f"  {name}: skipped ({e})")
        time.sleep(0.2)

    added = save_merged(OUTPUT_FILE, rows, key=["source", "city", "observed_at"])
    print(f"Fetched {len(rows)} cities, {added} new rows -> {OUTPUT_FILE}")


if __name__ == "__main__":
    cli(collect, "Fetch current weather for Indian cities from WeatherAPI.com", add_args)