import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';

function normalizeBasePath(value: string | undefined): string {
  const path = value?.trim();
  if (!path || path === '/') {
    return '/';
  }

  return `/${path.replace(/^\/+|\/+$/g, '')}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');

  return {
    // Local development stays at `/`. Deployments can set VITE_BASE_PATH,
    // for example `/mapsoo-worldforge/` for this repository's GitHub Pages site.
    base: normalizeBasePath(env.VITE_BASE_PATH),
    plugins: [react()],
    build: {
      target: 'es2022',
    },
  };
});
