# Training Dashboard

A personal training dashboard for tracking workouts and goals. Works as an
installable app on your phone (PWA) and as a regular web app on desktop.

## Stack

- **client/** — React + Vite + TypeScript, mobile-first responsive UI,
  installable PWA
- **server/** — Express + TypeScript API
- **Database** — SQLite via Prisma ORM

## Features

- Email/password auth
- Log workouts (run, ride, strength, swim, walk, other) with duration,
  distance, notes, and per-exercise sets/reps/weight for strength sessions
- Dashboard with weekly training volume chart and recent workouts
- Goals with progress tracking

## Getting started

### 1. Server

```bash
cd server
npm install
npx prisma migrate deploy   # creates the SQLite database
npm run dev                 # starts the API on http://localhost:4000
```

Edit `server/.env` to change `JWT_SECRET` before deploying anywhere real.

### 2. Client

```bash
cd client
npm install
npm run dev                 # starts the app on http://localhost:5173
```

The Vite dev server proxies `/api` requests to the backend, so just open
`http://localhost:5173` in a browser (or on your phone if it's on the same
network — use `npm run dev -- --host` for that).

### Installing on your phone

Once the app is deployed somewhere reachable from your phone, open it in
Chrome (Android) or Safari (iOS) and use "Add to Home Screen" — it installs
like a native app.

## Production build

```bash
cd server && npm run build && npm start
cd client && npm run build   # outputs static files to client/dist
```

For a real deployment, serve `client/dist` from a static host or from the
Express server, and point `DATABASE_URL` at a persistent volume (or swap
the Prisma datasource to Postgres later — the schema doesn't use any
SQLite-specific features).
