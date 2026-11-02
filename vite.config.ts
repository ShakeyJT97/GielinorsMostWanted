import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // Link previews (Discord, etc.) need the full site address for the image.
  // On Vercel this is filled in automatically; set VITE_SITE_URL to override.
  const site = (env.VITE_SITE_URL
    || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');

  return {
    plugins: [
      react(),
      {
        name: 'site-url-in-html',
        transformIndexHtml: (html) => html.replace(/__SITE_URL__/g, site),
      },
    ],
  };
});
