import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { env } from './env';

/**
 * Neon Postgres access layer.
 *
 * Nothing is hardcoded: the connection string is read from the environment at
 * runtime. The Vercel Neon integration usually exposes `DATABASE_URL`, but we
 * also accept the other common names so it "just works" once the variable is
 * added.
 */

export type Trip = {
  id: number;
  title: string;
  destination: string;
  start_date: string | null;
  end_date: string | null;
  travelers: number;
  price: number;
  currency: string;
  summary: string;
  itinerary: unknown; // JSON: array of { day, title, activities[] }
  booking_suggestions: unknown; // JSON: array of strings
  created_at: string;
  views?: number; // populated by listTrips (popularity)
};

export type Subscriber = {
  id: number;
  email: string;
  created_at: string;
};

export type TripView = {
  id: number;
  trip_id: number | null;
  title: string;
  destination: string;
  viewed_at: string;
  // Enriched from the linked trip (null for ad-hoc destination views).
  price: number | null;
  currency: string | null;
  days: number | null;
  start_date: string | null;
  end_date: string | null;
};

export type Testimonial = {
  id: number;
  name: string;
  detail: string;
  quote: string;
  created_at: string;
};

let _sql: NeonQueryFunction<false, false> | null = null;
let _schemaReady = false;

/** Returns the configured Neon connection string, or null if not set yet. */
export function getDatabaseUrl(): string | null {
  const url =
    env('DATABASE_URL') ||
    env('POSTGRES_URL') ||
    env('NEON_DATABASE_URL') ||
    env('POSTGRES_PRISMA_URL') ||
    '';
  return url.trim() ? url.trim() : null;
}

export function isDbConfigured(): boolean {
  return getDatabaseUrl() !== null;
}

/** Thrown when the database has not been configured yet. */
export class DbNotConfiguredError extends Error {
  constructor() {
    super(
      'Database is not configured. Add the Neon DATABASE_URL environment variable and redeploy.'
    );
    this.name = 'DbNotConfiguredError';
  }
}

/** Returns a cached Neon SQL tag. Throws DbNotConfiguredError if no URL. */
export function getSql(): NeonQueryFunction<false, false> {
  const url = getDatabaseUrl();
  if (!url) throw new DbNotConfiguredError();
  if (!_sql) _sql = neon(url);
  return _sql;
}

/** Creates tables if they don't exist. Cheap and idempotent. */
export async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS trips (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      destination TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      travelers INTEGER NOT NULL DEFAULT 1,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      summary TEXT NOT NULL DEFAULT '',
      itinerary JSONB NOT NULL DEFAULT '[]'::jsonb,
      booking_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // "Last visited" — records destinations/trips people recently explored.
  await sql`
    CREATE TABLE IF NOT EXISTS trip_views (
      id SERIAL PRIMARY KEY,
      trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      destination TEXT NOT NULL,
      viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS testimonials (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      quote TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  _schemaReady = true;
}

// --- Subscribers -----------------------------------------------------------

export async function addSubscriber(email: string): Promise<Subscriber> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO subscribers (email)
    VALUES (${email})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id, email, created_at
  `) as Subscriber[];
  return rows[0];
}

export async function listSubscriberEmails(): Promise<string[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`SELECT email FROM subscribers ORDER BY created_at ASC`) as {
    email: string;
  }[];
  return rows.map((r) => r.email);
}

export async function countSubscribers(): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`SELECT COUNT(*)::int AS count FROM subscribers`) as {
    count: number;
  }[];
  return rows[0]?.count ?? 0;
}

// --- Trips ------------------------------------------------------------------

export type NewTrip = {
  title: string;
  destination: string;
  start_date?: string | null;
  end_date?: string | null;
  travelers?: number;
  price?: number;
  currency?: string;
  summary?: string;
  itinerary?: unknown;
  booking_suggestions?: unknown;
};

export async function createTrip(trip: NewTrip): Promise<Trip> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`
    INSERT INTO trips (
      title, destination, start_date, end_date, travelers,
      price, currency, summary, itinerary, booking_suggestions
    )
    VALUES (
      ${trip.title},
      ${trip.destination},
      ${trip.start_date ?? null},
      ${trip.end_date ?? null},
      ${trip.travelers ?? 1},
      ${trip.price ?? 0},
      ${trip.currency ?? 'USD'},
      ${trip.summary ?? ''},
      ${JSON.stringify(trip.itinerary ?? [])}::jsonb,
      ${JSON.stringify(trip.booking_suggestions ?? [])}::jsonb
    )
    RETURNING *
  `) as Trip[];
  return rows[0];
}

export async function listTrips(sort: 'recent' | 'popular' = 'recent'): Promise<Trip[]> {
  await ensureSchema();
  const sql = getSql();
  const rows =
    sort === 'popular'
      ? ((await sql`
          SELECT t.*, COALESCE(vc.views, 0)::int AS views
          FROM trips t
          LEFT JOIN (
            SELECT lower(destination) AS k, COUNT(*)::int AS views
            FROM trip_views GROUP BY lower(destination)
          ) vc ON vc.k = lower(t.destination)
          ORDER BY views DESC, t.created_at DESC
        `) as Trip[])
      : ((await sql`
          SELECT t.*, COALESCE(vc.views, 0)::int AS views
          FROM trips t
          LEFT JOIN (
            SELECT lower(destination) AS k, COUNT(*)::int AS views
            FROM trip_views GROUP BY lower(destination)
          ) vc ON vc.k = lower(t.destination)
          ORDER BY t.created_at DESC
        `) as Trip[]);
  return rows.map(normalizeTrip);
}

export async function getTrip(id: number): Promise<Trip | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`SELECT * FROM trips WHERE id = ${id}`) as Trip[];
  return rows[0] ? normalizeTrip(rows[0]) : null;
}

/** Neon returns NUMERIC as string; coerce to a number for the frontend. */
function normalizeTrip(t: Trip): Trip {
  return { ...t, price: typeof t.price === 'string' ? parseFloat(t.price) : t.price };
}

// --- Trip views ("last visited") -------------------------------------------

export async function recordView(view: {
  tripId?: number | null;
  title?: string;
  destination: string;
}): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO trip_views (trip_id, title, destination)
    VALUES (${view.tripId ?? null}, ${view.title ?? ''}, ${view.destination})
  `;
}

/**
 * Returns the most recently viewed destinations, de-duplicated by destination
 * (keeping the latest view of each), newest first.
 */
export async function listRecentViews(limit = 6): Promise<TripView[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT DISTINCT ON (lower(v.destination))
      v.id, v.trip_id, v.title, v.destination, v.viewed_at,
      t.price, t.currency,
      COALESCE(jsonb_array_length(t.itinerary), 0) AS days,
      t.start_date, t.end_date
    FROM trip_views v
    LEFT JOIN trips t ON t.id = v.trip_id
    ORDER BY lower(v.destination), v.viewed_at DESC
  `) as (TripView & { price: string | number | null })[];
  return rows
    .map((r) => ({
      ...r,
      price: r.price == null ? null : typeof r.price === 'string' ? parseFloat(r.price) : r.price,
      days: r.days == null ? null : Number(r.days),
    }))
    .sort((a, b) => new Date(b.viewed_at).getTime() - new Date(a.viewed_at).getTime())
    .slice(0, limit);
}

// --- Testimonials -----------------------------------------------------------

export async function listTestimonials(limit = 6): Promise<Testimonial[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT id, name, detail, quote, created_at
    FROM testimonials ORDER BY created_at ASC LIMIT ${limit}
  `) as Testimonial[];
  return rows;
}

// --- Stats ------------------------------------------------------------------

export type Stats = { trips: number; subscribers: number; destinations: number; views: number };

export async function getStats(): Promise<Stats> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT
      (SELECT COUNT(*)::int FROM trips) AS trips,
      (SELECT COUNT(*)::int FROM subscribers) AS subscribers,
      (SELECT COUNT(DISTINCT lower(destination))::int FROM trips) AS destinations,
      (SELECT COUNT(*)::int FROM trip_views) AS views
  `) as Stats[];
  return rows[0] ?? { trips: 0, subscribers: 0, destinations: 0, views: 0 };
}

// --- Seeding ----------------------------------------------------------------

/**
 * Inserts a small set of curated trips and recent views, but only when the
 * trips table is empty (so it is safe to call repeatedly). Returns whether it
 * seeded and how many rows were added.
 */
export async function seedSampleData(): Promise<{
  seeded: boolean;
  trips: number;
  views: number;
  testimonials: number;
}> {
  await ensureSchema();
  const sql = getSql();

  const testimonialsAdded = await seedTestimonials();

  const existing = (await sql`SELECT COUNT(*)::int AS count FROM trips`) as { count: number }[];
  if ((existing[0]?.count ?? 0) > 0) {
    return { seeded: testimonialsAdded > 0, trips: 0, views: 0, testimonials: testimonialsAdded };
  }

  const samples: NewTrip[] = [
    {
      title: 'Cherry Blossoms in Kyoto',
      destination: 'Kyoto, Japan',
      start_date: '2026-04-02',
      end_date: '2026-04-06',
      travelers: 2,
      price: 1290,
      currency: 'USD',
      summary:
        'Temples, tea houses and the peak of sakura season across Kyoto\u2019s historic districts.',
      itinerary: [
        { day: 1, title: 'Arrival & Higashiyama', activities: ['Check in near Gion', 'Evening stroll through Higashiyama', 'Kaiseki welcome dinner'] },
        { day: 2, title: 'Temples & Bamboo', activities: ['Fushimi Inari at sunrise', 'Arashiyama bamboo grove', 'Riverside tea break'] },
        { day: 3, title: 'Gardens & Geisha', activities: ['Kinkaku-ji golden pavilion', 'Nishiki Market tasting', 'Gion evening walk'] },
        { day: 4, title: 'Day trip to Nara', activities: ['Todai-ji temple', 'Nara Park deer', 'Return for farewell ramen'] },
      ],
      booking_suggestions: ['Ryokan stay in Gion', 'JR Regional Pass', 'Guided tea ceremony', 'Fushimi Inari early tour'],
    },
    {
      title: 'Amalfi Coast Escape',
      destination: 'Amalfi Coast, Italy',
      start_date: '2026-06-10',
      end_date: '2026-06-15',
      travelers: 2,
      price: 1640,
      currency: 'EUR',
      summary: 'Cliffside villages, lemon groves and long lunches above the Tyrrhenian Sea.',
      itinerary: [
        { day: 1, title: 'Positano', activities: ['Check in above the beach', 'Sunset aperitivo', 'Seafood dinner'] },
        { day: 2, title: 'Path of the Gods', activities: ['Morning coastal hike', 'Swim in a hidden cove', 'Limoncello tasting'] },
        { day: 3, title: 'Capri', activities: ['Ferry to Capri', 'Blue Grotto boat tour', 'Piazzetta people-watching'] },
        { day: 4, title: 'Ravello', activities: ['Villa Rufolo gardens', 'Cooking class', 'Terrace dinner'] },
      ],
      booking_suggestions: ['Sea-view hotel in Positano', 'Private boat half-day', 'Cooking class in Ravello', 'Ferry passes'],
    },
    {
      title: 'Marrakech Medina & Desert',
      destination: 'Marrakech, Morocco',
      start_date: '2026-03-18',
      end_date: '2026-03-22',
      travelers: 3,
      price: 780,
      currency: 'USD',
      summary: 'Souks, riads and a night under the stars at the edge of the Agafay desert.',
      itinerary: [
        { day: 1, title: 'Medina', activities: ['Riad check-in', 'Jemaa el-Fnaa at dusk', 'Rooftop tagine'] },
        { day: 2, title: 'Palaces & Gardens', activities: ['Bahia Palace', 'Majorelle Garden', 'Hammam & mint tea'] },
        { day: 3, title: 'Agafay Desert', activities: ['Camel ride', 'Sunset dinner', 'Stargazing camp'] },
      ],
      booking_suggestions: ['Traditional riad', 'Desert camp night', 'Guided souk tour', 'Airport transfer'],
    },
    {
      title: 'Iceland Ring of Fire & Ice',
      destination: 'Reykjavik, Iceland',
      start_date: '2026-09-05',
      end_date: '2026-09-10',
      travelers: 2,
      price: 1980,
      currency: 'USD',
      summary: 'Waterfalls, black-sand beaches and the northern lights on a self-drive loop.',
      itinerary: [
        { day: 1, title: 'Reykjavik', activities: ['Pick up rental car', 'Harbour walk', 'Geothermal bakery dinner'] },
        { day: 2, title: 'Golden Circle', activities: ['Thingvellir', 'Geysir', 'Gullfoss waterfall'] },
        { day: 3, title: 'South Coast', activities: ['Seljalandsfoss', 'Reynisfjara black beach', 'Aurora watch'] },
      ],
      booking_suggestions: ['4x4 rental car', 'Blue Lagoon entry', 'Glacier hike guide', 'Northern lights tour'],
    },
  ];

  const created: Trip[] = [];
  for (const s of samples) created.push(await createTrip(s));

  // A few pre-existing "recently visited" entries (staggered timestamps).
  const seedViews = [
    { trip: created[0], hoursAgo: 3 },
    { trip: created[1], hoursAgo: 9 },
    { trip: created[3], hoursAgo: 26 },
    { trip: created[2], hoursAgo: 50 },
  ];
  for (const v of seedViews) {
    await sql`
      INSERT INTO trip_views (trip_id, title, destination, viewed_at)
      VALUES (${v.trip.id}, ${v.trip.title}, ${v.trip.destination}, now() - (${v.hoursAgo} || ' hours')::interval)
    `;
  }

  return { seeded: true, trips: created.length, views: seedViews.length, testimonials: testimonialsAdded };
}

/** Seeds a few reviews if the testimonials table is empty. */
async function seedTestimonials(): Promise<number> {
  const sql = getSql();
  const existing = (await sql`SELECT COUNT(*)::int AS count FROM testimonials`) as { count: number }[];
  if ((existing[0]?.count ?? 0) > 0) return 0;

  const rows = [
    {
      name: 'Amara O.',
      detail: 'Family trip · 5 days',
      quote:
        'I had a full Kyoto plan before my coffee went cold. The pacing was spot on for two jet-lagged parents.',
    },
    {
      name: 'Daniel R.',
      detail: 'Amalfi Coast · couple',
      quote: 'The price estimate landed within a few euros of what we actually spent. That never happens.',
    },
    {
      name: 'Priya S.',
      detail: 'Solo traveler',
      quote:
        'I subscribed on a whim and booked the Iceland trip they emailed two weeks later. No regrets.',
    },
    {
      name: 'Marcus T.',
      detail: 'Weekend break · 3 days',
      quote:
        'It suggested the neighborhoods locals actually recommend, not the tourist traps. Felt genuinely useful.',
    },
  ];
  for (const r of rows) {
    await sql`INSERT INTO testimonials (name, detail, quote) VALUES (${r.name}, ${r.detail}, ${r.quote})`;
  }
  return rows.length;
}
