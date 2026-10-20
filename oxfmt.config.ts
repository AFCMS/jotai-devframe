import { defineConfig } from "oxfmt";

export default defineConfig({
  sortImports: true,
  sortPackageJson: true,
  ignorePatterns: ["dist", "node_modules", "coverage", "build", ".agents"],
});
