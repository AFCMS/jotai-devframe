import { execFileSync } from "node:child_process";

import { expect, it } from "vitest";

it("chains an existing factory without replacing its store or installing twice", () => {
  const adapter = new URL("../src/internal/adapter.ts", import.meta.url).href;
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { createStore, INTERNAL_overrideCreateStore } from 'jotai/vanilla';
    import { INTERNAL_buildStoreRev4 } from 'jotai/vanilla/internals';
    const store = INTERNAL_buildStoreRev4();
    store.customMarker = true;
    let calls = 0;
    INTERNAL_overrideCreateStore(() => () => { calls++; return store; });
    const { installInstrumentation, trackStore } = await import(${JSON.stringify(adapter)});
    installInstrumentation(true);
    installInstrumentation(true);
    const result = createStore();
    console.log(JSON.stringify({ same: result === store, marker: result.customMarker, complete: trackStore(result).complete, calls }));
  `,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(JSON.parse(result)).toEqual({ same: true, marker: true, complete: true, calls: 1 });
});
