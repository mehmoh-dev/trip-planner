import type { APIRoute } from 'astro';
import { logout } from '../../../lib/auth';
import { ok } from '../../../lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  logout(cookies);
  return ok({ message: 'Logged out.' });
};
