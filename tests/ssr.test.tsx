import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";

import { JotaiDevtools, useAtomsSnapshot, useGotoAtomsSnapshot } from "../src/index";

it("renders safely on the server without creating a browser channel", () => {
  function Server() {
    const snapshot = useAtomsSnapshot();
    const goto = useGotoAtomsSnapshot();
    goto(snapshot);
    return (
      <>
        <JotaiDevtools />
        <span>{snapshot.values.size}</span>
      </>
    );
  }
  expect(renderToString(<Server />)).toBe("<span>0</span>");
  expect(Reflect.has(globalThis, Symbol.for("@afcms/jotai-devframe/runtime-v1"))).toBe(false);
});
