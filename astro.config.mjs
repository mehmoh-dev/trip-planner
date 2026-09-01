// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // Server-side rendering so API routes, the database and email work on Vercel.
  output: 'server',
  adapter: vercel(),
});
