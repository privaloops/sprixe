import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
  },
});
