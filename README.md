# National Weather Big Data Analytics Platform (NWBDAP)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Status: In development](https://img.shields.io/badge/status-in%20development-orange.svg)

Real-time, crowd-sourced weather intelligence for India. The platform collects weather-related reports from social media (Bluesky, Mastodon), public weather APIs, and citizen submissions, then enriches them with an ML pipeline (SVM event classifier, geotagger, credibility scorer, deduplicator) running on Apache Spark, and visualises verified events on a live dashboard.

Final-year B.Tech major project, based on the Smart India Hackathon problem statement *"National Weather Big Data Analytics Platform"*.

---

## What it does

- **Collects** weather reports from Bluesky, Mastodon, OpenWeatherMap, WeatherAPI.com and citizen form submissions, with metadata: timestamp, city, state, GPS location, event category and media attachments
- **Enriches** every social/API post through a Python ML pipeline: SVM event classifier, India gazetteer geotagger, credibility scorer, and near-duplicate detector
- **Streams** enriched posts with Apache Spark Structured Streaming (file-based; Kafka is the planned production swap)
- **Deduplicates** reports that describe the same real-world event (geohash + time window + text similarity)
- **Scores trust** for each report (0–100) and flags uncertain ones for human review
- **Classifies** events: `rainfall`, `thunderstorm`, `flooding`, `heatwave`, `fog`, `dust_storm`, `strong_winds`
- **Visualises** verified events on a dashboard with live map pins, date/event/location filters, and admin verification queue
- **Pushes** new pins to the browser in real time via SSE (Server-Sent Events)

---

## Architecture (as implemented)

```
[Bluesky / Mastodon collectors]   [OpenWeatherMap / WeatherAPI.com]   [Citizen form]
          |                                      |                            |
          v                                      v                            |
    stream_in/*.json           notable observations only                     |
          |                            |                                     |
          v                            v                                     |
  spark_stream.py ──── enricher.py ────────────────────────────────────     |
  (Spark Structured Streaming)                                               |
  • SVM event classifier                                                     |
  • India gazetteer geotagger                                                |
  • Credibility scorer                                                       |
  • Duplicate detector                                                       |
          |                                                                  |
          v                                                                  v
  POST /api/reports/ingest  ◄────────────────────── POST /api/reports (citizen)
  (shared ingest key auth)
          |
          v
      MongoDB  ──►  backend-api (Node/Express/TypeScript)
                    • REST API (reports, auth, weather, admin)
                    • SSE push (new pins, status changes)
                    • In-process dedup + trust for citizen reports
                    • Admin verification queue
                          |
                          v
               frontend-dashboard (React / Vite)
               • Live Map  (Leaflet)
               • Events list + filters
               • Overview charts  (Recharts)
               • Admin panel (approve / reject)
               • Citizen report form
```

**Key design decisions:**

| Decision | Choice |
|---|---|
| Who classifies social/API posts? | Python SVM (weather_api_new) |
| Who classifies citizen reports? | Node in-process keyword classifier |
| Double-classification prevented? | Yes — backend skips ML for reports that already have `category` + `trustScore` |
| Who writes to MongoDB? | Python pushes via `POST /api/reports/ingest`; Node serves all reads |
| Admin decisions overwritten by re-ingest? | No — insert-or-ignore on `reportId` |
| Live weather for Overview page? | Backend calls OpenWeatherMap directly (`GET /api/weather?city=`) |
| Python double-polling weather? | Disabled — `DISABLE_WEATHER_COLLECTOR=true` in backend `.env` |

---

## Repository structure

```
-national-weather-bigdata/       ← THIS REPO
├── backend-api/                 REST API, data models, auth, SSE, admin
│   ├── src/
│   │   ├── models/              Mongoose schemas (Report, User, Cluster, Source, VerificationLog)
│   │   ├── routes/              Express routes (reports, auth, weather, admin, events, sse)
│   │   ├── services/            pipeline.ts, weatherCollector.ts, sse.ts
│   │   └── scripts/             start-mongo.ts (local MongoDB via mongodb-memory-server)
│   ├── data/mongodb/            Persistent MongoDB WiredTiger data (git-ignored)
│   └── .env                     Runtime config (see below)
├── frontend-dashboard/          React + Vite public dashboard and admin panel
│   └── src/
│       ├── pages/               LiveMap, Events, Overview, Admin, CitizenReport, Verify
│       └── components/          Map, Charts, ReportCard, AdminQueue …
├── ingestion-service/           ⚠ STUB — placeholder; actual ingestion is in weather_api_new
├── stream-processing/           ⚠ STUB — placeholder; actual processing is in weather_api_new
├── ml-models/                   ⚠ STUB — model training assets moved to weather_api_new
└── infra/                       Kafka + Docker Compose stubs (future production swap)

weather_api_new/                 ← SEPARATE REPO (ML + Spark layer)
├── spark_stream.py              Spark Structured Streaming job (stream_in/ → MongoDB)
├── pipeline.py                  Batch fallback (CSV → MongoDB)
├── enricher.py                  ML pipeline: classifier + geotagger + credibility + dedup
├── db.py                        MongoDB sink: push_to_api() preferred, direct Mongo fallback
├── report_mapping.py            CONTRACT — single source of truth for field name translation
├── bluesky_data.py              Bluesky live collector (firehose)
├── mastodon_data.py             Mastodon live collector (streaming API)
├── stream_bluesky.py            CLI entrypoint → bluesky_data.run()
├── stream_mastodon.py           CLI entrypoint → mastodon_data.main()
├── weather_collector.py         OpenWeatherMap / WeatherAPI.com poller
├── stream_in/                   Drop zone: Spark reads JSON files from here
├── stream_state/                Spark checkpoint (git-ignored)
└── .env                         Runtime config (see below)
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Leaflet, Recharts |
| Backend API | Node.js 24, Express 4, TypeScript, Mongoose |
| Real-time push | Server-Sent Events (SSE) |
| ML / NLP | Python 3, scikit-learn (SVM + TF-IDF), NLTK |
| Stream processing | Apache Spark 3.5 Structured Streaming |
| Storage | MongoDB (local via `mongodb-memory-server`; Atlas for production) |
| Infra (future) | Apache Kafka, Docker Compose |

---

## Getting started

### Prerequisites

- Node.js ≥ 20 and npm ≥ 10
- Python 3.10–3.14 with `pip`
- Java 17–21 (**recommended**; Java 25 works with JVM flags set in `spark_stream.py`)

### 1. MongoDB (local, persistent)

```bash
cd backend-api
npm install
npm run mongo          # keeps running — leave this terminal open
```

Data persists in `backend-api/data/mongodb/` across restarts.

### 2. Backend API

```bash
cd backend-api
cp .env.example .env   # fill in your OPENWEATHER_API_KEY
npm run dev            # nodemon + ts-node, port 4000
```

Seed demo data (optional):

```bash
npm run seed           # inserts ~370 demo reports
```

### 3. Frontend dashboard

```bash
cd frontend-dashboard
npm install
npm run dev            # Vite dev server, port 5173
```

Open <http://localhost:5173>.

### 4. Python ML layer

```bash
cd weather_api_new
pip install -r requirements.txt
cp .env.example .env   # fill in API keys
```

**Batch ingest** (CSV → MongoDB):

```bash
python pipeline.py bluesky_posts.csv mastodon_posts.csv --db
```

**Spark stream** (watches `stream_in/` for new JSON files):

```bash
python spark_stream.py          # continuous
python spark_stream.py --once   # process existing files and exit
```

**Live collectors** (write JSON to `stream_in/` for Spark to pick up):

```bash
python stream_bluesky.py --replay-hours 1
python stream_mastodon.py
```

---

## Configuration

### `backend-api/.env`

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP listen port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/nwbdap` | MongoDB connection string |
| `JWT_SECRET` | *(set this!)* | Secret for JWT tokens |
| `INGEST_KEY` | `national-weather-shared-ingest-key-2026` | Shared key for Python → backend ingest |
| `OPENWEATHER_API_KEY` | *(set this!)* | For live weather on Overview page |
| `PIPELINE_MODE` | `inprocess` | `inprocess` = Node classifies citizens; `external` = skip all ML |
| `DISABLE_WEATHER_COLLECTOR` | `true` | Set `true` when Python polls weather so Node doesn't double-poll |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS allowed origins (comma-separated) |

### `weather_api_new/.env`

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string (same as backend) |
| `API_URL` | Backend API base URL (e.g. `http://localhost:4000`) |
| `INGEST_KEY` | Must match backend `INGEST_KEY` |
| `BLUESKY_HANDLE` | Bluesky account handle |
| `BLUESKY_APP_PASSWORD` | Bluesky app password |
| `MASTODON_INSTANCE` | Mastodon server URL |
| `MASTODON_TOKEN` | Mastodon access token |
| `OPENWEATHER_API_KEY` | OpenWeatherMap API key |
| `WEATHERAPI_KEY` | WeatherAPI.com key |

---

## Data contract

`weather_api_new/report_mapping.py` is the **single source of truth** for translating Python/ML field names into the backend MongoDB `Report` schema. **Do not** change backend-api or frontend-dashboard field names to match the Python layer.

Key mappings:

| Python / ML | MongoDB / API | Notes |
|---|---|---|
| `text` | `rawText` | Raw post text |
| `source` (bluesky/mastodon) | `sourceType: "social"` | Via `SOURCE_TYPE` dict |
| `source` (openweathermap) | `sourceType: "api"` | |
| `event` / `category` | `category` | Normalised to backend enum |
| `flood` | `flooding` | Via `CATEGORY_ALIASES` |
| `strong_wind` | `strong_winds` | Via `CATEGORY_ALIASES` |
| `credibility` (0–1) | `trustScore` (0–100) | `_trust_score()` scales both |
| `credibility_reasons` | `trustReasons` | |
| `uri` / `url` | `sourceRef` | |
| `pending` | `needs_review` | Status normalised in `to_report_document()` |

---

## Demo credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@nwa.local` | `Admin@12345` |
| Moderator | `moderator@nwa.local` | `Moderator@12345` |

---

## Folder notes

`ingestion-service/`, `stream-processing/`, and `ml-models/` are **placeholder stubs** from the original project scaffold. Their functionality lives in `weather_api_new/`. They are kept for the project report's folder-structure diagram and will be removed after the demo.

`infra/` contains Kafka and Docker Compose configuration stubs. The current demo uses Spark file streaming instead of Kafka. Kafka remains the planned production swap — `spark_stream.py` already documents the migration path (`spark.readStream.format("kafka")`).

---

## License

Released under the [MIT License](LICENSE).
