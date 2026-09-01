import type { APIRoute } from 'astro';
import { generateItinerary, type TripPreferences } from '../../lib/ai';
import { badRequest, json, readJson, serverError } from '../../lib/http';

export const prerender = false;

/**
 * Generates a personalized AI itinerary (and estimated journey price) from the
 * user's preferences. Does not require the database or admin auth — anyone
 * planning a trip can use it.
 */
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  const destination = String(body.destination || '').trim();
  if (!destination) return badRequest('Destination is required.');

  const prefs: TripPreferences = {
    destination,
    startDate: body.startDate ? String(body.startDate) : null,
    endDate: body.endDate ? String(body.endDate) : null,
    travelers: body.travelers ? Math.max(1, parseInt(String(body.travelers), 10) || 1) : 1,
    budget: body.budget ? Number(body.budget) || null : null,
    currency: body.currency ? String(body.currency) : 'USD',
    interests: body.interests ? String(body.interests) : '',
    pace: body.pace ? String(body.pace) : 'balanced',
  };

  try {
    const itinerary = await generateItinerary(prefs);
    return json({ ok: true, itinerary });
  } catch (err) {
    console.error('itinerary error:', err);
    return serverError('Could not generate an itinerary right now. Please try again.');
  }
};
