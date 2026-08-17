import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

// `base` must match your repo name when deploying to GitHub Pages, e.g.
// https://<username>.github.io/enclave/ -> base: '/enclave/'
// Set via env var so local dev (base: '/') isn't affected.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  },
  define: {
    // Baked in at build time so you can confirm a deploy actually picked up
    // your latest changes instead of guessing from a stale cache. Bump the
    // version in package.json (or just check the timestamp) and compare
    // against what's printed in the browser console / UI footer.
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  }
});
