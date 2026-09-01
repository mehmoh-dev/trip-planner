import type { APIRoute } from 'astro';
import { DbNotConfiguredError, getStats } from '../../lib/db';
import { json, serverError } from '../../lib/http';

export const prerender = false;

/** Public: live counts for the home page stat bar. */
export const GET: APIRoute = async () => {
  try {
    const stats = await getStats();
    return json({ ok: true, stats });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) {
      return json({ ok: true, stats: { trips: 0, subscribers: 0, destinations: 0, views: 0 }, dbConfigured: false });
    }
    console.error('stats error:', err);
    return serverError('Could not load stats.');
  }
};
