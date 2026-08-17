import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

// `base` must match your repo name when deploying to GitHub Pages, e.g.
// https://<username>.github.io/enclave/ -> base: '/enclave/'
// Set via env var so local dev (base: '/') isn't affected.
export default defineConfig(({ mode }) => {
  // This is the SAME lookup Vite does internally for import.meta.env - doing
  // it explicitly here lets us print, in the terminal, at build time,
  // exactly what Vite is about to bake into the bundle. If VITE_API_URL is
  // missing here, no amount of redeploying will fix it - the .env file
  // Vite is reading isn't the one you edited.
  const env = loadEnv(mode, __dirname, '');
  const envProductionPath = path.resolve(__dirname, '.env.production');

  console.log('--- Vite build-time env check ---');
  console.log(`[vite-config] mode                = ${mode}`);
  console.log(`[vite-config] cwd (envDir)         = ${__dirname}`);
  console.log(`[vite-config] .env.production exists at that path? ${existsSync(envProductionPath) ? 'YES' : 'NO - this is almost certainly the bug'}`);
  console.log(`[vite-config] VITE_API_URL resolved = ${env.VITE_API_URL || '(NOT SET - build will fall back to localhost:4000!)'}`);
  console.log('----------------------------------');

  return {
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
  };
});
