# National Weather Big Data Analytics Platform (NWBDAP)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Status: In development](https://img.shields.io/badge/status-in%20development-orange.svg)

Real-time, crowd-sourced weather intelligence for India. The platform collects weather-related reports from social media (posts tagged `#IMD` and related hashtags), public weather APIs, and citizen submissions, then verifies them with ML-based fake-report detection and deduplication, and visualizes the verified events on a live dashboard.

Final-year B.Tech major project, based on the Smart India Hackathon problem statement *"National Weather Big Data Analytics Platform"*.

## What it does

- **Collects** weather reports from multiple sources, with metadata: timestamp, city, state, GPS location, photos/videos, and event category
- **Streams** every report through a Kafka pipeline so ingestion scales independently of processing
- **Deduplicates** reports that describe the same real-world event (geohash + time window + text similarity)
- **Scores trust** for each report and flags fake or misleading ones for human review
- **Classifies** events: rainfall, thunderstorm, flooding, heatwave, fog, dust storm, strong winds
- **Visualizes** verified events on a dashboard with date, event, location, and verification-status filters
- **Admin panel** for moderators to review, approve, or reject flagged reports

## Architecture

```
[Citizen form] [Social media API] [IMD / weather APIs]
        |
        v   ingestion-service (Kafka producers)
   Kafka topic: raw-reports
        |
        v   stream-processing (consumers)
   dedup -> trust score -> classification
        |
        v
   Kafka topic: enriched-reports
        |
        v   backend-api (storage consumer)
   MongoDB
        |
        v
   REST API -> frontend-dashboard (public dashboard + admin panel)
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Leaflet, Recharts |
| Backend API | Node.js, Express, TypeScript |
| Streaming | Apache Kafka |
| Processing | Kafka consumers, Apache Spark |
| ML / NLP | Python |
| Storage | MongoDB |
| Infra | Docker, Docker Compose |

## Repository structure

```
.
├── backend-api/            REST API, data models, auth, storage consumer
├── ingestion-service/      Data collectors and Kafka producers
├── stream-processing/      Dedup, trust-score, and classification consumers; Spark jobs
├── ml-models/              Model training and sample data
├── frontend-dashboard/     Public dashboard and admin panel
└── infra/                  Kafka and Docker configuration
```

## Getting started

The project is at an early stage and the folder structure is in place, with implementation underway. Setup and run instructions will be added here as each service becomes runnable.

## License

Released under the [MIT License](LICENSE).
