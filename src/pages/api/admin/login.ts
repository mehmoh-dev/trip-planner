import type { APIRoute } from 'astro';
import { isAdminConfigured, login, verifyCredentials } from '../../../lib/auth';
import { badRequest, ok, readJson, serviceUnavailable, unauthorized } from '../../../lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isAdminConfigured()) {
    return serviceUnavailable('Admin not configured. Set ADMIN_EMAIL and ADMIN_PASSWORD.');
  }

  const body = await readJson(request);
  const email = String(body.email || '');
  const password = String(body.password || '');
  if (!email || !password) return badRequest('Email and password are required.');

  if (!verifyCredentials(email, password)) {
    return unauthorized('Invalid email or password.');
  }

  login(cookies);
  return ok({ message: 'Logged in.' });
};
