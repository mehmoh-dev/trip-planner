import type { APIRoute } from 'astro';
import { DbNotConfiguredError, listRecentViews, recordView } from '../../lib/db';
import { badRequest, json, ok, readJson, serverError } from '../../lib/http';

export const prerender = false;

/** Public: recently explored destinations ("last visited"). */
export const GET: APIRoute = async ({ url }) => {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '6', 10) || 6, 1), 12);
  try {
    const views = await listRecentViews(limit);
    return json({ ok: true, views });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return json({ ok: true, views: [], dbConfigured: false });
    console.error('list views error:', err);
    return serverError('Could not load recent views.');
  }
};

/** Public: record a view when someone explores a destination or trip. */
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  const destination = String(body.destination || '').trim();
  if (!destination) return badRequest('Destination is required.');
  try {
    await recordView({
      tripId: body.tripId ? parseInt(String(body.tripId), 10) : null,
      title: body.title ? String(body.title) : '',
      destination,
    });
    return ok();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return ok(); // silently ignore before DB is set
    console.error('record view error:', err);
    return serverError('Could not record view.');
  }
};
