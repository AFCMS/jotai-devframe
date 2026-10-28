import { fileURLToPath } from "node:url";

import { jotaiDevtools } from "@afcms/jotai-devframe/vite";
import { DevTools } from "@vitejs/devtools";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [DevTools(), jotaiDevtools()],
  server: { host: "127.0.0.1" },
  build: { outDir: "../../build/example-vite", emptyOutDir: true },
});
