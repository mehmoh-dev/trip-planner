/** Small helpers for JSON API responses. */

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function ok(data: Record<string, unknown> = {}): Response {
  return json({ ok: true, ...data }, 200);
}

export function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

export function unauthorized(message = 'Not authorized'): Response {
  return json({ ok: false, error: message }, 401);
}

export function serviceUnavailable(message: string): Response {
  return json({ ok: false, error: message }, 503);
}

export function serverError(message: string): Response {
  return json({ ok: false, error: message }, 500);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Reads a JSON body defensively; returns {} on parse failure. */
export async function readJson(request: Request): Promise<Record<string, any>> {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}
