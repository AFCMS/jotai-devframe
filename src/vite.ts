import { createPluginFromDevframe } from "@vitejs/devtools-kit/node";

import { createJotaiDevframe, type JotaiDevframeOptions } from "./devframe";

export function jotaiDevtools(
  options: JotaiDevframeOptions = {},
): ReturnType<typeof createPluginFromDevframe> {
  const plugin = createPluginFromDevframe(createJotaiDevframe(options));
  return { ...plugin, apply: "serve" as const };
}

export default jotaiDevtools;
