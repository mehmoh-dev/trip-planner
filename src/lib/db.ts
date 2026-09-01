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
};

export type Subscriber = {
  id: number;
  email: string;
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

export async function listTrips(): Promise<Trip[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`SELECT * FROM trips ORDER BY created_at DESC`) as Trip[];
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
