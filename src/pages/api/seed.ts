import type { APIRoute } from 'astro';
import { DbNotConfiguredError, seedSampleData } from '../../lib/db';
import { isAuthenticated } from '../../lib/auth';
import { json, ok, serverError, serviceUnavailable, unauthorized } from '../../lib/http';

export const prerender = false;

/** Admin: load a few curated sample trips + recent views (only if empty). */
export const POST: APIRoute = async ({ cookies }) => {
  if (!isAuthenticated(cookies)) return unauthorized('Admin login required.');
  try {
    const result = await seedSampleData();
    return ok({
      message: result.seeded
        ? `Added ${result.trips} sample trips and ${result.views} recent views.`
        : 'Sample data was skipped because trips already exist.',
      ...result,
    });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return serviceUnavailable(err.message);
    console.error('seed error:', err);
    return serverError('Could not seed sample data.');
  }
};
