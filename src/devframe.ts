import { fileURLToPath } from "node:url";

import { defineDevframe } from "devframe";
import type { DevframeDefinition } from "devframe";

import pkg from "../package.json" with { type: "json" };

export interface JotaiDevframeOptions {
  id?: string;
  name?: string;
  icon?: string;
  basePath?: string;
}

export function createJotaiDevframe(options: JotaiDevframeOptions = {}): DevframeDefinition {
  return defineDevframe({
    id: options.id ?? "jotai-devtools",
    name: options.name ?? "Jotai",
    icon: options.icon ?? "ph:ghost-duotone",
    version: pkg.version,
    packageName: pkg.name,
    homepage: pkg.homepage,
    description: pkg.description,
    importMetaUrl: import.meta.url,
    basePath: options.basePath ?? "/__jotai-devtools/",
    // Resolve from the published entry, not the working directory.
    clientAssets: fileURLToPath(new URL("../panel/", import.meta.url)),
    capabilities: { dev: true, build: false },
    setup() {},
  });
}

export default createJotaiDevframe;
