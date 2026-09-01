import type { APIRoute } from 'astro';
import { isAuthenticated, isAdminConfigured } from '../../../lib/auth';
import { countSubscribers, isDbConfigured } from '../../../lib/db';
import { isMailConfigured } from '../../../lib/mail';
import { isAiConfigured } from '../../../lib/ai';
import { json } from '../../../lib/http';

export const prerender = false;

/** Reports live system readiness so the admin UI never shows hardcoded state. */
export const GET: APIRoute = async ({ cookies }) => {
  const authenticated = isAuthenticated(cookies);

  let subscribers = 0;
  if (authenticated && isDbConfigured()) {
    try {
      subscribers = await countSubscribers();
    } catch {
      subscribers = 0;
    }
  }

  return json({
    ok: true,
    authenticated,
    config: {
      adminConfigured: isAdminConfigured(),
      dbConfigured: isDbConfigured(),
      mailConfigured: isMailConfigured(),
      aiConfigured: isAiConfigured(),
    },
    subscribers,
  });
};
