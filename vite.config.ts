import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative Pfade, damit der Build auch aus einem Unterordner (z. B. GitHub Pages) läuft.
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    // Rapier (compat) bringt sein WASM inline als base64 mit (~4,3 MB, gzip ~1,7 MB) – das ist erwartet.
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        // Engine-Bibliotheken in eigene Chunks: ändern sich selten → bleiben im Browser-Cache.
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
});
