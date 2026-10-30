# backend-api

Node 20 + Express + TypeScript + MongoDB. Serves the NWA Platform dashboard (`frontend-dashboard`) and, by default, also runs the processing pipeline (dedup, trust score, classification) so the whole system works with just MongoDB, no Kafka needed.

## Run it

1. Start MongoDB (local install, or a free MongoDB Atlas connection string).
2. Copy `.env.example` to `.env` and set `MONGO_URI` and `JWT_SECRET`.
3. Install, create the demo data, start:

       npm install
       npm run seed        # sign-in accounts, settings, sources and about 370 demo reports
       npm run dev         # http://localhost:4000

4. In `frontend-dashboard` run `npm install` and `npm run dev`. It talks to `http://localhost:4000` by default (change with `VITE_API_URL`). The top bar shows **LIVE DATA** when it is connected.

Sign-in after seeding (change these in `.env` before sharing the project):

| Role | Email | Password |
|---|---|---|
| Admin | admin@nwa.local | Admin@12345 |
| Moderator | moderator@nwa.local | Moderator@12345 |

`npm run seed -- --reset` wipes reports and regenerates the demo data. Hotspots only count reports from the last 60 minutes, so re-run the seed shortly before a demo to see them.

Delete `setup-backend.js` from the folder. It was the old generator script, and running it again would overwrite these files.

## What happens to a report

1. `POST /api/reports` saves it as **pending** and returns the tracking ID. City and state text are turned into map coordinates using the built-in gazetteer.
2. The pipeline (`src/services/pipeline.ts`, SRS section 8) groups it with reports about the same event, scores trust out of 100 from five signals, and classifies the event type.
3. Score of 75 or more (and confident, with a known location): **verified** by the system. Otherwise **needs_review**. The system never rejects. Only moderators can.
4. The result is saved, written to the audit log, and pushed to open dashboards through `GET /api/stream`.
5. When more sources confirm an event, earlier reports of it that are still in review are re-scored and can become verified.

Set `PIPELINE_MODE=external` if your teammates' Kafka consumers should do steps 2 and 3. This server then only stores and serves.

## Endpoints

Public: `GET /health`, `GET /api/reports` (filters: dateFrom, dateTo, category, state, city, status, clusterId, bbox, lat+lng+radiusKm, page, limit up to 500, sort), `GET /api/reports/:id`, `POST /api/reports`, `POST /api/media`, `GET /api/clusters`, `GET /api/clusters/:id`, `GET /api/alerts`, `GET /api/weather?city=`, `GET /api/export` (CSV), `GET /api/stream` (live events), `GET /api/analytics/summary|timeseries|hotspots`, `POST /api/auth/login`.

Staff (Bearer token): `GET /api/auth/me`, `GET /api/admin/queue`, `GET /api/admin/reports/:id`, `PATCH /api/admin/reports/:id/verify`, `GET /api/admin/reports/:id/audit`, `POST /api/admin/clusters/:id/merge`.

Admin only: `GET|PUT /api/admin/config`, `GET|POST|PATCH /api/admin/users`, `POST /api/admin/users/:id/reset-password`, `GET /api/admin/sources`, `PATCH /api/admin/sources/:id`, `GET /api/admin/pipeline`, `POST /api/admin/alerts`, `DELETE /api/admin/alerts/:id`.

Errors always look like `{ "error": { "code": "...", "message": "..." } }`.

## Settings you can change in the dashboard (Settings page)

Auto-verify threshold, minimum classifier confidence, dedup distance, time window and similarity, hotspot sources/window, polling intervals, hashtags. Values are range-checked and take effect within about 15 seconds.

## Safety measures included

Rate limits (5 reports per hour per IP and 10 sign-ins per 15 minutes in production, relaxed otherwise), CORS limited to `CLIENT_ORIGIN`, helmet headers, validated query strings and bodies, uploads checked by file content (JPEG, PNG, WebP, MP4; images up to 5 MB, video up to 25 MB), bcrypt passwords, role checks on every staff route, no IP addresses stored, CSV export protected against spreadsheet formulas. In production the server refuses to start without `JWT_SECRET`.

## Known limits

- Classification is the keyword baseline from SRS 8.3 (English, Hindi, Hinglish). Your ML teammate's `predict()` can replace `classifyText` later.
- "Photo already used" is detected by exact file match, not perceptual hashing, and EXIF checks are not done yet.
- Live conditions and official observations need a free `OPENWEATHER_API_KEY`. Without it the Overview page shows labelled sample conditions.
- Official bulletins (IMD) have no public feed wired in. Admins can publish alerts with `POST /api/admin/alerts`, and community hotspots are detected automatically. The seed adds clearly labelled sample bulletins.
- Photos are stored on local disk under `uploads/`. Swap in MinIO or S3 before deploying.
- No OpenAPI page yet.
