import type { APIRoute } from 'astro';
import { addSubscriber, DbNotConfiguredError } from '../../lib/db';
import { badRequest, isValidEmail, ok, readJson, serverError, serviceUnavailable } from '../../lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  const email = String(body.email || '').trim().toLowerCase();

  if (!isValidEmail(email)) {
    return badRequest('Please provide a valid email address.');
  }

  try {
    await addSubscriber(email);
    return ok({ message: "You're subscribed! We'll email you when new trips are added." });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return serviceUnavailable(err.message);
    console.error('subscribe error:', err);
    return serverError('Could not save your subscription. Please try again.');
  }
};
