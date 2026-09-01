import crypto from 'node:crypto';
import type { AstroCookies } from 'astro';
import { env } from './env';

/**
 * Minimal admin auth for the demo panel.
 *
 * Credentials (ADMIN_EMAIL / ADMIN_PASSWORD) are checked, and on success a
 * signed HMAC token is stored in an httpOnly cookie. This is intentionally
 * lightweight — suitable for a single-admin demo, not multi-user production
 * auth.
 */

const COOKIE_NAME = 'admin_session';
const MAX_AGE = 60 * 60 * 8; // 8 hours

function secret(): string {
  // Falls back to the admin password so it still works before the dedicated
  // secret is set, but ADMIN_SESSION_SECRET is strongly recommended.
  return env('ADMIN_SESSION_SECRET') || env('ADMIN_PASSWORD') || 'insecure-dev-secret';
}

export function isAdminConfigured(): boolean {
  return Boolean(env('ADMIN_EMAIL') && env('ADMIN_PASSWORD'));
}

/** Constant-time credential check. */
export function verifyCredentials(email: string, password: string): boolean {
  const expectedEmail = env('ADMIN_EMAIL') || '';
  const expectedPass = env('ADMIN_PASSWORD') || '';
  if (!expectedEmail || !expectedPass) return false;
  return safeEqual(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase()) &&
    safeEqual(password, expectedPass);
}

function sign(value: string): string {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

/** token = base64(payload).signature */
function makeToken(): string {
  const payload = JSON.stringify({ role: 'admin', iat: Date.now() });
  const b64 = Buffer.from(payload).toString('base64url');
  return `${b64}.${sign(b64)}`;
}

function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return false;
  if (!safeEqual(sig, sign(b64))) return false;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (payload.role !== 'admin') return false;
    if (Date.now() - Number(payload.iat) > MAX_AGE * 1000) return false;
    return true;
  } catch {
    return false;
  }
}

export function login(cookies: AstroCookies): void {
  cookies.set(COOKIE_NAME, makeToken(), {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function logout(cookies: AstroCookies): void {
  cookies.delete(COOKIE_NAME, { path: '/' });
}

export function isAuthenticated(cookies: AstroCookies): boolean {
  return isValidToken(cookies.get(COOKIE_NAME)?.value);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
