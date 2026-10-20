// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://sudomuhammad.github.io',
  vite: {
    server: {
      // Builds and impeccable tooling write here; watching them restarts the dev server mid-request.
      watch: { ignored: ['**/dist/**', '**/.impeccable/**'] },
    },
  },
});
