import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { checkPackage, createPackageFromTarballData } from "@arethetypeswrong/core";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

import { pack } from "./package.ts";

const packed = await pack();
try {
  const { messages, pkg } = await publint({
    pack: { tarball: Uint8Array.from(packed.data).buffer },
    level: "suggestion",
    strict: true,
  });
  for (const message of messages) console.log(formatMessage(message, pkg));
  assert.equal(messages.length, 0, "publint failed");
  const result = await checkPackage(createPackageFromTarballData(packed.data));
  assert.ok(result.types, "Package must expose TypeScript declarations");
  const problems = result.problems.filter(
    (p) => !("resolutionKind" in p) || !["node10", "node16-cjs"].includes(p.resolutionKind),
  );
  assert.deepEqual(problems, [], "Are The Types Wrong (esm-only) failed");
  console.log("publint and Are The Types Wrong (esm-only): passed");
} finally {
  await rm(packed.directory, { recursive: true, force: true });
}
