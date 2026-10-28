import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: { outDir: "../dist/panel", emptyOutDir: true },
});
