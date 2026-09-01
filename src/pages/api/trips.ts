import type { APIRoute } from 'astro';
import { createTrip, DbNotConfiguredError, listTrips, listSubscriberEmails } from '../../lib/db';
import { isAuthenticated } from '../../lib/auth';
import { buildTripEmail, isMailConfigured, sendToMany } from '../../lib/mail';
import {
  badRequest,
  json,
  ok,
  readJson,
  serverError,
  serviceUnavailable,
  unauthorized,
} from '../../lib/http';

export const prerender = false;

/** Public: list all trips (used by the planner UI and admin). */
export const GET: APIRoute = async () => {
  try {
    const trips = await listTrips();
    return json({ ok: true, trips });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return json({ ok: true, trips: [], dbConfigured: false });
    console.error('list trips error:', err);
    return serverError('Could not load trips.');
  }
};

/** Admin: create a trip, then email all subscribers about it. */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) return unauthorized('Admin login required.');

  const body = await readJson(request);
  const title = String(body.title || '').trim();
  const destination = String(body.destination || '').trim();
  if (!title) return badRequest('Trip title is required.');
  if (!destination) return badRequest('Destination is required.');

  const price = Number(body.price);
  const trip = {
    title,
    destination,
    start_date: body.startDate ? String(body.startDate) : null,
    end_date: body.endDate ? String(body.endDate) : null,
    travelers: body.travelers ? Math.max(1, parseInt(String(body.travelers), 10) || 1) : 1,
    price: isFinite(price) && price >= 0 ? price : 0,
    currency: body.currency ? String(body.currency) : 'USD',
    summary: body.summary ? String(body.summary) : '',
    itinerary: Array.isArray(body.itinerary) ? body.itinerary : [],
    booking_suggestions: Array.isArray(body.bookingSuggestions) ? body.bookingSuggestions : [],
  };

  try {
    const created = await createTrip(trip);

    // Notify subscribers (best-effort; trip is already saved).
    let notified = { sent: 0, failed: 0, total: 0 };
    let notifyError: string | null = null;
    if (body.notify !== false) {
      if (!isMailConfigured()) {
        notifyError = 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD).';
      } else {
        try {
          const recipients = await listSubscriberEmails();
          if (recipients.length) {
            const { subject, html, text } = buildTripEmail(created);
            notified = await sendToMany(recipients, subject, html, text);
          }
        } catch (e) {
          notifyError = 'Trip saved, but sending notifications failed.';
          console.error('notify on create error:', e);
        }
      }
    }

    return ok({ trip: created, notified, notifyError });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return serviceUnavailable(err.message);
    console.error('create trip error:', err);
    return serverError('Could not create the trip.');
  }
};
