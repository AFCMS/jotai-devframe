import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { createJotaiDevframe } from "@afcms/jotai-devframe/devframe";
import { initDevframe } from "devframe/initiate";
import { context } from "esbuild";

const production = process.env.NODE_ENV === "production";
const build = await context({
  absWorkingDir: fileURLToPath(new URL("../..", import.meta.url)),
  entryPoints: ["examples/node/main.tsx"],
  bundle: true,
  write: false,
  outdir: "build/example-node",
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  conditions: [production ? "production" : "development"],
  define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
  sourcemap: "inline",
});
// A real development host mounts the same Web-Standard/Connect handler. There
// is no Vite runtime and no server-side relay for application state.
const inspector = production
  ? null
  : initDevframe(createJotaiDevframe(), { base: "/__jotai-devtools/" });
const html =
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jotai Devtools · Node + esbuild</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const server = createServer((request, response) => {
  const next = async () => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(html);
        return;
      }
      if (path !== "/app.js" && path !== "/app.css") {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const result = await build.rebuild();
      const output = result.outputFiles?.find((file) =>
        file.path.endsWith(path === "/app.js" ? "main.js" : "main.css"),
      );
      if (!output) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.setHeader(
        "Content-Type",
        path.endsWith(".js") ? "application/javascript" : "text/css",
      );
      response.end(output.contents);
    } catch (error) {
      console.error(error);
      response.writeHead(500);
      response.end("Build failed; see terminal.");
    }
  };
  if (inspector && (request.url ?? "").startsWith(inspector.base))
    inspector.nodeMiddleware(request, response, () => {
      void next();
    });
  else void next();
});
const port = Number(process.env.PORT ?? 4488);
await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
await inspector?.ready;
const address = server.address();
assert.ok(address && typeof address === "object", "Node host must listen on a TCP port");
console.log(`Jotai playground: http://127.0.0.1:${address.port}/`);
async function close() {
  await inspector?.close();
  await build.dispose();
  server.close();
}
process.once("SIGINT", () => {
  void close();
});
process.once("SIGTERM", () => {
  void close();
});
