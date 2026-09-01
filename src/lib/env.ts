/**
 * Unified environment variable access.
 *
 * Why both sources?
 *  - process.env      -> populated at RUNTIME on Vercel (dashboard variables,
 *                        Neon integration, etc. — including vars added AFTER
 *                        the build). This is the source of truth in production.
 *  - import.meta.env  -> populated in local `astro dev` from .env / .env.local
 *                        files (and inlined at build time).
 *
 * Reading process.env first means variables added later in the Vercel/Neon
 * dashboard are picked up without a rebuild, while local development still
 * works from .env.local.
 */
export function env(key: string): string | undefined {
  const fromProcess =
    typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
  if (fromProcess != null && String(fromProcess).trim() !== '') return String(fromProcess);

  try {
    const metaEnv = (import.meta as any)?.env;
    const v = metaEnv ? metaEnv[key] : undefined;
    if (v != null && String(v).trim() !== '') return String(v);
  } catch {
    /* import.meta.env not available in this context */
  }
  return undefined;
}
