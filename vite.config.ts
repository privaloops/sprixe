import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
