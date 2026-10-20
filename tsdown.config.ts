import { defineConfig } from "tsdown";

export default defineConfig({
  format: ["esm"],
  sourcemap: true,
  dts: {
    generator: "tsgo",
  },
  platform: "node",
  exports: true,
  publint: {
    enabled: true,
    level: "error",
    strict: true,
  },
  attw: {
    enabled: true,
    level: "error",
    profile: "esm-only",
  },
});
