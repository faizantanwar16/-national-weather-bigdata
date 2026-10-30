"""
India geotagger: spaCy NER + GeoNames gazetteer (no training needed).

One-time setup:
  pip install spacy && python -m spacy download en_core_web_sm
  From https://download.geonames.org/export/dump/ download IN.zip (unzip -> IN.txt)
  and admin1CodesASCII.txt, then build the gazetteer:
      python geotagger.py build IN.txt admin1CodesASCII.txt data/india_gazetteer.csv

Try it:
  python geotagger.py demo "Heavy rain and waterlogging near Andheri, Mumbai"
"""
import csv
import math
import re
import sys

import numpy as np

# Approximate state / UT centroids, used as a fallback when only a state is mentioned
STATE_CENTROIDS = {
    "Andhra Pradesh": (15.9129, 79.7400), "Arunachal Pradesh": (28.2180, 94.7278),
    "Assam": (26.2006, 92.9376), "Bihar": (25.0961, 85.3131),
    "Chhattisgarh": (21.2787, 81.8661), "Goa": (15.2993, 74.1240),
    "Gujarat": (22.2587, 71.1924), "Haryana": (29.0588, 76.0856),
    "Himachal Pradesh": (31.1048, 77.1734), "Jharkhand": (23.6102, 85.2799),
    "Karnataka": (15.3173, 75.7139), "Kerala": (10.8505, 76.2711),
    "Madhya Pradesh": (22.9734, 78.6569), "Maharashtra": (19.7515, 75.7139),
    "Manipur": (24.6637, 93.9063), "Meghalaya": (25.4670, 91.3662),
    "Mizoram": (23.1645, 92.9376), "Nagaland": (26.1584, 94.5624),
    "Odisha": (20.9517, 85.0985), "Punjab": (31.1471, 75.3412),
    "Rajasthan": (27.0238, 74.2179), "Sikkim": (27.5330, 88.5122),
    "Tamil Nadu": (11.1271, 78.6569), "Telangana": (18.1124, 79.0193),
    "Tripura": (23.9408, 91.9882), "Uttar Pradesh": (26.8467, 80.9462),
    "Uttarakhand": (30.0668, 79.0193), "West Bengal": (22.9868, 87.8550),
    "Delhi": (28.7041, 77.1025), "Jammu and Kashmir": (33.7782, 76.5762),
    "Ladakh": (34.1526, 77.5770), "Chandigarh": (30.7333, 76.7794),
    "Puducherry": (11.9416, 79.8083),
    "Andaman and Nicobar Islands": (11.7401, 92.6586),
    "Lakshadweep": (10.5667, 72.6417),
    "Dadra and Nagar Haveli and Daman and Diu": (20.3974, 72.8328),
}
STATE_ALIASES = {
    "orissa": "Odisha", "bengal": "West Bengal", "uttaranchal": "Uttarakhand",
    "pondicherry": "Puducherry", "new delhi": "Delhi", "nct": "Delhi",
    "jammu & kashmir": "Jammu and Kashmir", "j&k": "Jammu and Kashmir",
}
# Old / alternate city names -> name used in the gazetteer (lowercase)
CITY_ALIASES = {
    "bombay": "mumbai", "calcutta": "kolkata", "madras": "chennai",
    "bangalore": "bengaluru", "gurgaon": "gurugram", "poona": "pune",
    "trivandrum": "thiruvananthapuram", "cochin": "kochi", "baroda": "vadodara",
    "benares": "varanasi", "banaras": "varanasi", "vizag": "visakhapatnam",
}
# Place names that are also common weather/English words -> ignore
STOPWORDS = {"rain", "flood", "storm", "heat", "wind", "dust", "city", "road",
             "sunny", "cloud", "clouds", "hail", "mist", "cold", "warm", "high"}
STATE_FIX = {"Orissa": "Odisha", "NCT": "Delhi",
             "National Capital Territory of Delhi": "Delhi"}


def build_gazetteer(geonames_file, admin1_file, out_csv, min_population=20000):
    """Convert GeoNames IN.txt into a small CSV of Indian populated places."""
    states = {}
    with open(admin1_file, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if parts[0].startswith("IN."):
                states[parts[0][3:]] = STATE_FIX.get(parts[1], parts[1])

    seen, rows = set(), []
    with open(geonames_file, encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            if len(c) < 15 or c[6] != "P":          # P = populated place
                continue
            pop = int(c[14] or 0)
            if pop < min_population:
                continue
            state, canonical = states.get(c[10], ""), c[2]
            primary = {c[1], c[2]}
            for n in primary | set(c[3].split(",")):
                n = n.strip()
                min_len = 3 if n in primary else 4   # stricter for alternate names
                if len(n) < min_len or not n.isascii() or n.lower() in STOPWORDS:
                    continue
                key = (n.lower(), canonical, state)
                if key not in seen:
                    seen.add(key)
                    rows.append([n.lower(), canonical, state, c[4], c[5], pop])

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "canonical", "state", "lat", "lon", "population"])
        w.writerows(rows)
    print(f"Wrote {len(rows)} name entries to {out_csv}")


class GeoTagger:
    def __init__(self, gazetteer_csv="data/india_gazetteer.csv", model="en_core_web_sm"):
        import spacy
        from spacy.matcher import PhraseMatcher

        self.nlp = spacy.load(model, disable=["lemmatizer", "parser"])

        self.places = {}   # lowercase name -> list of candidate places
        with open(gazetteer_csv, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                self.places.setdefault(r["name"], []).append({
                    "city": r["canonical"], "state": r["state"],
                    "lat": float(r["lat"]), "lon": float(r["lon"]),
                    "pop": int(r["population"]),
                })

        uniq = {(e["city"], e["state"]): e for es in self.places.values() for e in es}
        self.cities = list(uniq.values())
        self.lat_r = np.radians([c["lat"] for c in self.cities])
        self.lon_r = np.radians([c["lon"] for c in self.cities])

        self.matcher = PhraseMatcher(self.nlp.vocab, attr="LOWER")
        names = list(self.places) + list(CITY_ALIASES)
        self.matcher.add("PLACE", list(self.nlp.tokenizer.pipe(names)))

        self.state_lookup = {s.lower(): s for s in STATE_CENTROIDS}
        self.state_lookup.update({a: s for a, s in STATE_ALIASES.items()})
        pattern = "|".join(re.escape(s) for s in sorted(self.state_lookup, key=len, reverse=True))
        self.state_re = re.compile(rf"(?<!\w)({pattern})(?!\w)", re.IGNORECASE)

    # ---------- helpers ----------
    @staticmethod
    def _prep(text):
        # "#MumbaiRains" -> " Mumbai Rains " so NER / matching can see the city
        def split_tag(m):
            return " " + re.sub(r"(?<=[a-z])(?=[A-Z])", " ", m.group(1)) + " "
        return re.sub(r"#(\w+)", split_tag, str(text))

    def _states_in(self, text):
        return {self.state_lookup[m.group(1).lower()] for m in self.state_re.finditer(text)}

    def _lookup(self, name):
        return self.places.get(CITY_ALIASES.get(name, name)) or self.places.get(name)

    @staticmethod
    def _empty(method="none"):
        return {"city": "", "state": "", "lat": None, "lon": None,
                "geo_confidence": 0.0, "geo_method": method}

    def _from_gps(self, lat, lon):
        if not (6 <= lat <= 38 and 68 <= lon <= 98):
            return self._empty("gps_outside_india")
        la, lo = math.radians(lat), math.radians(lon)
        cosd = np.sin(la) * np.sin(self.lat_r) + np.cos(la) * np.cos(self.lat_r) * np.cos(self.lon_r - lo)
        c = self.cities[int(np.arccos(np.clip(cosd, -1, 1)).argmin())]
        return {"city": c["city"], "state": c["state"], "lat": lat, "lon": lon,
                "geo_confidence": 1.0, "geo_method": "gps"}

    # ---------- main entry point ----------
    def tag(self, text, gps=None):
        """gps = (lat, lon) if the post carries coordinates. Returns a dict."""
        if gps:
            return self._from_gps(*gps)

        text = self._prep(text)
        doc = self.nlp(text)
        ner = {e.text.lower() for e in doc.ents if e.label_ in {"GPE", "LOC", "FAC"}}
        found = {doc[s:e].text.lower() for _, s, e in self.matcher(doc)}
        states = self._states_in(text)

        best = None
        for cand in found | ner:
            entries = self._lookup(cand)
            if not entries:
                continue
            in_state = [e for e in entries if e["state"] in states]
            pick = max(in_state or entries, key=lambda e: e["pop"])
            score = math.log10(pick["pop"] + 10) + (3 if in_state else 0) + (1 if cand in ner else 0)
            if best is None or score > best[0]:
                best = (score, pick, bool(in_state), len(entries) > 1)

        if best:
            _, pick, state_ok, ambiguous = best
            conf = 0.95 if state_ok and not ambiguous else 0.9 if state_ok else 0.5 if ambiguous else 0.8
            return {"city": pick["city"], "state": pick["state"], "lat": pick["lat"],
                    "lon": pick["lon"], "geo_confidence": conf, "geo_method": "gazetteer"}

        if states:   # no city found, but a state was mentioned
            s = sorted(states)[0]
            lat, lon = STATE_CENTROIDS[s]
            return {"city": "", "state": s, "lat": lat, "lon": lon,
                    "geo_confidence": 0.4, "geo_method": "state_only"}
        return self._empty()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "build":
        build_gazetteer(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "demo":
        print(GeoTagger().tag(" ".join(sys.argv[2:])))
    else:
        print(__doc__)
