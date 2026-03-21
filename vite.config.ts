import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    target: "es2022",
    outDir: "dist",
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (AudioWorklet ring buffer)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      "/api/rom": {
        target: "https://archive.org",
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) =>
          `/download/mame-0.260-roms-non-merged/MAME%200.260%20ROMs%20%28non-merged%29/MAME%200.260%20ROMs%20%28non-merged%29/${path.replace("/api/rom/", "")}`,
      },
    },
  },
});
