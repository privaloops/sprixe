import { defineConfig } from "vite";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import type { Plugin } from "vite";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

/** Vite plugin: serves /api/roms listing .zip files in public/roms/ */
function romsListPlugin(): Plugin {
  return {
    name: "roms-list",
    configureServer(server) {
      server.middlewares.use("/api/roms", (_req, res) => {
        try {
          const romsDir = join(process.cwd(), "public", "roms");
          const files = readdirSync(romsDir)
            .filter(f => f.endsWith(".zip"))
            .map(f => f.replace(".zip", ""))
            .sort();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(files));
        } catch {
          res.setHeader("Content-Type", "application/json");
          res.end("[]");
        }
      });
    },
  };
}

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
      'tests/e2e/**',
    ],
  },
  root: ".",
  publicDir: "public",
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        play: resolve(__dirname, "play/index.html"),
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    romsListPlugin(),
    // COOP/COEP only on /play/ (SharedArrayBuffer). Landing needs YouTube embed.
    {
      name: "coop-coep-play-only",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/play")) {
            res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          }
          next();
        });
      },
    },
  ],
});
