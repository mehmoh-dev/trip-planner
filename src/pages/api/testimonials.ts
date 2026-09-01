import type { APIRoute } from 'astro';
import { DbNotConfiguredError, listTestimonials } from '../../lib/db';
import { json, serverError } from '../../lib/http';

export const prerender = false;

/** Public: traveler reviews shown on the home page. */
export const GET: APIRoute = async () => {
  try {
    const testimonials = await listTestimonials(6);
    return json({ ok: true, testimonials });
  } catch (err) {
    if (err instanceof DbNotConfiguredError) return json({ ok: true, testimonials: [], dbConfigured: false });
    console.error('testimonials error:', err);
    return serverError('Could not load testimonials.');
  }
};
