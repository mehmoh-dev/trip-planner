# AI Trip Planner

Plan personalized trips with AI-generated itineraries, journey pricing, booking
suggestions, and email reminders. Built with Astro (SSR), Neon Postgres, Gmail,
and Google Gemini. Deploys to Vercel.

## Features

- **AI itinerary generation** — day-by-day plans from a destination, dates,
  interests, and pace (Google Gemini, with a deterministic fallback).
- **Journey price** — estimated per-person price returned with each itinerary
  and stored with each published trip.
- **Booking suggestions** — hotels, tours, transport, and passes per trip.
- **Subscriptions** — visitors subscribe by email to hear about new trips.
- **Notifications (Gmail)** — new trips can auto-email all subscribers, plus an
  admin "Send to all subscribers" button.
- **Admin panel** — login, publish trips, and manage notifications at `/admin`.

Everything is dynamic: the frontend reads live data from the backend API and the
database. Nothing about trips, prices, or subscribers is hardcoded.

## Project structure

```
src/
  lib/            # backend modules
    env.ts        # env access (process.env at runtime, import.meta.env in dev)
    db.ts         # Neon Postgres: schema + queries (subscribers, trips)
    mail.ts       # Gmail (nodemailer) notifications
    ai.ts         # Gemini itinerary generation (+ fallback)
    auth.ts       # admin cookie session
    http.ts       # JSON response helpers
  pages/
    index.astro   # Planner UI (itinerary, subscribe, trips list)
    admin.astro   # Admin dashboard
    api/
      itinerary.ts     # POST — generate itinerary + price
      subscribe.ts     # POST — add subscriber
      trips.ts         # GET list / POST create (+ notify)
      notify.ts        # POST — send a trip to all subscribers
      admin/login.ts   # POST — admin login
      admin/logout.ts  # POST — admin logout
      admin/status.ts  # GET — live config + subscriber count
```

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in values.
3. `npm run dev` then open http://localhost:4321

## Environment variables

See `.env.example`. Required for full functionality:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres pooled connection string |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Gmail App Password for notifications |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin panel login |
| `ADMIN_SESSION_SECRET` | Signs the admin session cookie |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Gemini itinerary generation |
| `PUBLIC_SITE_NAME` | Site name shown in the UI/emails |

The app reads `process.env` first (so variables added later in the Vercel/Neon
dashboard work without a rebuild) and falls back to `.env.local` in development.

## Deploy to Vercel + Neon

1. Push this repo to GitHub and import it into Vercel (the `@astrojs/vercel`
   adapter is already configured).
2. In Vercel, add the Neon integration (Storage → Neon). It provisions the
   database and sets `DATABASE_URL` automatically.
3. Add the remaining environment variables under Project Settings →
   Environment Variables.
4. Redeploy. Database tables are created automatically on first use.

The database schema is created lazily (`CREATE TABLE IF NOT EXISTS`) the first
time an API route touches the database — no migration step required.
