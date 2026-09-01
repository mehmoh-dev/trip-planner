import type { APIRoute } from 'astro';
import { DbNotConfiguredError, getTrip, listSubscriberEmails, listTrips } from '../../lib/db';
import { isAuthenticated } from '../../lib/auth';
import { buildTripEmail, isMailConfigured, sendToMany } from '../../lib/mail';
import { badRequest, json, ok, readJson, serverError, serviceUnavailable, unauthorized } from '../../lib/http';

export const prerender = false;

/**
 * Admin: manually send a trip announcement to every subscriber.
 * Body: { tripId?: number }  — if omitted, sends the most recent trip.
 * This backs the "Send to all subscribed users" button.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAuthenticated(cookies)) return unauthorized('Admin login required.');

  if (!isMailConfigured()) {
    return serviceUnavailable('Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD.');
  }

  const body = await readJson(request);

  try {
    let trip;
    if (body.tripId) {
      trip = await getTrip(parseInt(String(body.tripId), 10));
      if (!trip) return badRequest('Trip not found.');
    } else {
      const trips = await listTrips();
      if (!trips.length) return badRequest('No trips available to send.');
      trip = trips[0]; // most recent (listTrips is ordered desc)
    }

    const recipients = await listSubscriberEmails();
    if (!recipients.length) {
      return ok({ message: 'No subscribers yet.', notified: { sent: 0, failed: 0, total: 0 } });
    }

    const { subject, html, text } = buildTripEmail(trip);
    const notified = await sendToMany(recipients, subject, html, text);

    return ok({
      message: `Sent to ${notified.sent} of ${notified.total} subscriber(s).`,
      trip: { id: trip.id, title: trip.title },
      notified,
    });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return serviceUnavailable(err.message);
    console.error('notify error:', err);
    return serverError('Could not send notifications.');
  }
};
