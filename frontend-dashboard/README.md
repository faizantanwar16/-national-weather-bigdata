# NWA Platform: frontend-dashboard

React 19 + TypeScript + Vite. Dark "weather operations" UI with a left sidebar, live map, alerts, analytics, a report form and a staff console.

## Run

    npm install
    npm run dev          # http://localhost:5173
    npm run build        # production build in dist/

The app calls `backend-api` at `http://localhost:4000`. Change it with `VITE_API_URL` in a `.env` file.

## Demo mode

If the backend can't be reached, the app switches to realistic sample data automatically (a "DEMO DATA" badge shows in the top bar). Force it with `VITE_DEMO=1`. Sample staff sign-in: use the "Explore the admin console with sample data" button on the sign-in page.

## Pages

| Sidebar item | Route | Who |
|---|---|---|
| Overview | `/` | public |
| Live Map | `/map` | public |
| Weather Events | `/events` | public |
| Analytics | `/analytics` | public |
| Reports (submit) | `/report`, `/track/:id` | public |
| Alerts | `/alerts` | public |
| Verification | `/verification` | moderator, admin |
| Data Sources, Admin Panel, System Health, Settings | `/sources`, `/admin`, `/health`, `/settings` | admin |

## Where the data comes from

All data access goes through `src/api/gateway.ts`. It calls your backend first and falls back to sample data. Endpoints it expects from SRS section 7.1 that your backend may not have yet: `/api/stream` (SSE), `/api/media`, `/api/clusters/:id`, `/api/admin/reports/:id`, `/api/admin/sources`, `/api/admin/pipeline`, plus `/api/alerts` and `/api/weather?city=` for official alerts and conditions. Screens that need a missing endpoint fall back or say "not available yet".
