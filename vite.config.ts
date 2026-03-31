import path from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve("src/desktop/renderer"),
  base: "./",
  publicDir: false,
  build: {
    outDir: path.resolve("dist/desktop/renderer"),
    emptyOutDir: true,
  },
});
