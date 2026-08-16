import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` must match your repo name when deploying to GitHub Pages, e.g.
// https://<username>.github.io/enclave/ -> base: '/enclave/'
// Set via env var so local dev (base: '/') isn't affected.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    host: true,
    port: 5173
  }
});
