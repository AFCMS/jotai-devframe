import { defineConfig, type UserConfig } from "tsdown";

const common = {
  format: ["esm"],
  sourcemap: true,
  dts: { generator: "tsgo" },
  target: "es2023",
  exports: false,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  deps: { neverBundle: [/^react(?:\/|$)/, /^jotai(?:\/|$)/, /^devframe(?:\/|$)/, /^@vitejs\//] },
} as const satisfies UserConfig;

export default defineConfig([
  {
    ...common,
    name: "browser",
    platform: "browser",
    outDir: "dist/browser",
    banner: '"use client";',
    entry: {
      index: "src/index.ts",
      utils: "src/utils.ts",
      runtime: "src/runtime.ts",
      register: "src/register.ts",
      bootstrap: "src/internal/bootstrap.ts",
      noop: "src/noop.ts",
      "noop-runtime": "src/noop-runtime.ts",
      "noop-register": "src/noop-register.ts",
    },
  },
  {
    ...common,
    name: "node",
    platform: "node",
    outDir: "dist/node",
    entry: { devframe: "src/devframe.ts", vite: "src/vite.ts" },
  },
]);
