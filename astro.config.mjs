// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://sudomuhammad.github.io',
  // The dev toolbar sits where the ask bar does; keep it out of the way.
  devToolbar: { enabled: false },
  vite: {
    // Transformers.js loads its ONNX/WebAssembly runtime itself; pre-bundling it breaks that.
    optimizeDeps: { exclude: ['@huggingface/transformers'] },
    server: {
      // Builds and impeccable tooling write here; watching them restarts the dev server mid-request.
      watch: { ignored: ['**/dist/**', '**/.impeccable/**'] },
    },
  },
});
