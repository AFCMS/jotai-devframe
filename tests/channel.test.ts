import { connectPanelChannel } from "devframe/in-page-channel";
import { atom, createStore } from "jotai/vanilla";
import { expect, it } from "vitest";

import { installInstrumentation } from "../src/internal/adapter";
import { createRuntimeChannel } from "../src/internal/channel";
import { RuntimeController } from "../src/internal/controller";
import {
  CHANNEL_NAME,
  type JotaiChannelProtocol,
  type RuntimeState,
} from "../src/internal/protocol";

it("replays state to multiple panels and transports safe values and errors", async () => {
  installInstrumentation(true);
  const runtime = new RuntimeController();
  const store = createStore();
  const a = atom({ callback() {}, value: 0 });
  a.debugLabel = "test";
  const unsub = store.sub(a, () => {});
  const detach = runtime.attach(store);
  const host = createRuntimeChannel(runtime, false);
  function panel() {
    const pair = new MessageChannel();
    host.channel.addPanelPort(pair.port1);
    return connectPanelChannel<JotaiChannelProtocol>({
      name: CHANNEL_NAME,
      window: false,
      transport: pair.port2,
      functions: {},
    });
  }
  const first = panel();
  const second = panel();
  try {
    const mirror = await first.sharedState.get("runtime");
    const state = mirror.value() as RuntimeState;
    const target = { sessionId: state.sessionId, storeId: state.stores[0]!.id };
    const detail = await first.call("getAtom", {
      ...target,
      atomId: state.stores[0]!.atoms[0]!.id,
    });
    expect(detail.value.entries![0]!.value.kind).toBe("function");
    await first.call("setRecording", { ...target, recording: true });
    store.set(a, { callback() {}, value: 2 });
    const nextMirror = await second.sharedState.get("runtime");
    await viWaitFor(() =>
      expect(nextMirror.value().stores[0]!.history.length).toBeGreaterThanOrEqual(2),
    );
    await expect(first.call("clearHistory", { ...target, sessionId: "expired" })).rejects.toThrow(
      "expired",
    );
    first.close();
    expect((await second.call("getInfo")).sessionId).toBe(runtime.sessionId);
  } finally {
    first.close();
    second.close();
    host.close();
    detach();
    unsub();
  }
});

async function viWaitFor(assertion: () => void) {
  const deadline = Date.now() + 1500;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
