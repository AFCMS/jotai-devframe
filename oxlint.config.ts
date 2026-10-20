import { defineConfig } from "oxlint";

export default defineConfig({
  options: {
    typeAware: true,
  },
  ignorePatterns: ["dist", "node_modules", "coverage", "build", ".agents", "old"],
  jsPlugins: ["@e18e/eslint-plugin"],
  rules: {
    "oxc/no-barrel-file": "error",
    "e18e/prefer-static-regex": "error",
    "e18e/prefer-regex-test": "error",
  },
});
