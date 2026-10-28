import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { initDevframe } from "devframe/initiate";
import { build as esbuild } from "esbuild";
import { build as viteBuild, createServer, type ViteDevServer } from "vite";

import { pack, root, run } from "./package.ts";

const packed = await pack();
const LOCAL_ORIGIN = /http:\/\/127\.0\.0\.1:\d+/;
const SCRIPT_SOURCE = /<script[^>]*src="([^"]+)"/g;
const FIRST_SCRIPT = /<script[^>]*src="([^"]+)"/;
const STYLESHEET = /<link[^>]*href="([^"]+\.css)"/;
const consumer = join(packed.directory, "consumer");
let vite: ViteDevServer | undefined;
let child: ChildProcess | undefined;
try {
  const library = join(consumer, "node_modules/@afcms/jotai-devframe");
  await mkdir(library, { recursive: true });
  await run("tar", ["-xzf", packed.path, "-C", library, "--strip-components=1"]);
  for (const dependency of [
    "react",
    "react-dom",
    "jotai",
    "devframe",
    "vite",
    "@vitejs/devtools",
    "@vitejs/devtools-kit",
    "esbuild",
  ]) {
    const destination = join(consumer, "node_modules", dependency);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(join(root, "node_modules", dependency), destination, "dir");
  }
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ name: "packed-package-consumer", private: true, type: "module" }),
  );
  await cp(join(root, "examples"), join(consumer, "examples"), { recursive: true });

  const production = await esbuild({
    absWorkingDir: consumer,
    stdin: {
      contents:
        'import { JotaiDevtools } from "@afcms/jotai-devframe"; globalThis.inspectComponent = JotaiDevtools;',
      resolveDir: consumer,
    },
    bundle: true,
    write: false,
    format: "esm",
    minify: true,
    platform: "browser",
    conditions: ["production"],
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const productionCode = production.outputFiles[0].text;
  assert.ok(
    productionCode.length < 5000,
    `Production bridge should be a no-op, got ${productionCode.length} bytes`,
  );
  assert.ok(
    !productionCode.includes("devframes:plugin:jotai-devtools"),
    "Production includes a channel",
  );
  assert.ok(!productionCode.includes("overrideCreateStore"), "Production includes instrumentation");
  await import(`data:text/javascript,${encodeURIComponent(productionCode)}`);
  assert.equal(Reflect.get(globalThis, "inspectComponent")(), null);
  Reflect.deleteProperty(globalThis, "inspectComponent");
  assert.equal(Reflect.has(globalThis, Symbol.for("@afcms/jotai-devframe/adapter-v1")), false);
  assert.equal(Reflect.has(globalThis, Symbol.for("@afcms/jotai-devframe/runtime-v1")), false);

  await viteBuild({
    configFile: join(consumer, "examples/vite/vite.config.ts"),
    logLevel: "error",
  });
  const development = await esbuild({
    absWorkingDir: consumer,
    entryPoints: ["examples/node/main.tsx"],
    bundle: true,
    write: false,
    outdir: "build/node",
    format: "esm",
    jsx: "automatic",
    platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const developmentScript = development.outputFiles.find((f) => f.path.endsWith(".js"));
  assert.ok(developmentScript, "Development build must emit JavaScript");
  const developmentCode = developmentScript.text;
  assert.ok(developmentCode.includes("devframes:plugin:jotai-devtools"));
  assert.ok(!/from ["']node:/.test(developmentCode), "Browser bundle imports Node built-ins");
  const developmentStylesheet = development.outputFiles.find((f) => f.path.endsWith(".css"));
  assert.ok(developmentStylesheet, "Development build must emit CSS");
  const css = developmentStylesheet.text;
  assert.ok(!css.includes(".tree-children"), "Application CSS contains the inspector stylesheet");
  const manifest = JSON.parse(
    await readFile(join(library, "package.json"), "utf8"),
  ) as typeof import("../package.json");
  for (const [path, entry] of Object.entries(manifest.exports)) {
    if (typeof entry !== "object") continue;
    await readFile(join(library, entry.types));
    await readFile(join(library, entry.default));
    if (!path.includes("vite") && !path.includes("devframe")) {
      const code = await readFile(join(library, entry.default), "utf8");
      assert.ok(!code.includes("node:"), `${path} imports a Node built-in`);
    }
  }

  const { createJotaiDevframe } = await import(
    pathToFileURL(join(library, "dist/node/devframe.js")).href
  );
  const customBase = "/tools/jotai/";
  const custom = initDevframe(createJotaiDevframe({ basePath: customBase }), { base: customBase });
  try {
    await custom.ready;
    const response = await custom.handler(new Request(`http://localhost${customBase}`));
    assert.equal(response.status, 200, "Custom mount does not serve the panel");
    const html = await response.text();
    const script = html.match(FIRST_SCRIPT);
    const stylesheet = html.match(STYLESHEET);
    assert.ok(script, "Panel must include a script");
    assert.ok(stylesheet, "Panel must include a stylesheet");
    for (const asset of [script[1], stylesheet[1]]) {
      const assetResponse = await custom.handler(
        new Request(new URL(asset, `http://localhost${customBase}`)),
      );
      assert.equal(assetResponse.status, 200, "Custom mount is missing a relative panel asset");
    }
  } finally {
    await custom.close();
  }

  if (process.argv.includes("--build-only")) {
    console.log(
      "Packed package: exports, both example builds, CSS isolation, production elimination passed",
    );
  } else {
    process.env.NODE_ENV = "development";
    vite = await createServer({
      configFile: join(consumer, "examples/vite/vite.config.ts"),
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0 },
    });
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === "object", "Vite must listen on a TCP port");
    const origin = `http://127.0.0.1:${address.port}`;
    await checkPanel(origin);
    assert.equal(
      (await fetch(`${origin}/__devtools/`)).status,
      200,
      "Real Vite Devtools host is missing",
    );
    const appHtml = await (await fetch(origin)).text();
    const scripts = [...appHtml.matchAll(SCRIPT_SOURCE)].map((match) => match[1]);
    const modules = await Promise.all(
      scripts.map(async (path) => (await fetch(new URL(path, origin))).text()),
    );
    assert.ok(
      modules.some((code) => code.includes("/__devtools/embedded.js")),
      "Vite dock bootstrap is missing",
    );

    const node = spawn(
      process.execPath,
      ["--import", import.meta.resolve("@oxc-node/core/register"), "examples/node/server.ts"],
      {
        cwd: consumer,
        env: { ...process.env, NODE_ENV: "development", PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child = node;
    const nodeOrigin = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error(`Node host failed to start: ${output}`)),
        15000,
      );
      node.stdout.on("data", (data) => {
        output += data;
        const match = output.match(LOCAL_ORIGIN);
        if (match) {
          clearTimeout(timer);
          resolve(match[0]);
        }
      });
      node.stderr.on("data", (data) => {
        output += data;
      });
      node.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      node.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Node host exited (${code}): ${output}`));
      });
    });
    await checkPanel(nodeOrigin);
    assert.ok(
      (await (await fetch(`${nodeOrigin}/app.js`)).text()).includes(
        "devframes:plugin:jotai-devtools",
      ),
    );
    console.log(
      "Packed package: Vite Devtools + Node/esbuild hosts, assets, exports, CSS isolation, production elimination passed",
    );
  }
} finally {
  child?.kill("SIGTERM");
  await vite?.close();
  await rm(packed.directory, { recursive: true, force: true });
}

async function checkPanel(origin: string) {
  const url = `${origin}/__jotai-devtools/`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("Jotai Devtools"));
  const script = html.match(FIRST_SCRIPT);
  const stylesheet = html.match(STYLESHEET);
  assert.ok(script, "Panel must include a script");
  assert.ok(stylesheet, "Panel must include a stylesheet");
  for (const asset of [script[1], stylesheet[1]])
    assert.equal((await fetch(new URL(asset, url))).status, 200, `Missing panel asset: ${asset}`);
}
