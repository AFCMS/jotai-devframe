import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { atom, createStore } from "jotai/vanilla";
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import { App } from "../panel/app";
import { createRuntimeChannel } from "../src/internal/channel";
import { RuntimeController } from "../src/internal/controller";

let host: ReturnType<typeof createRuntimeChannel> | undefined;
const COUNT_ATOM = /countAtom/;
const TIMELINE_TAB = /^Timeline/;
const FIRST_SNAPSHOT = /^01/;
const RESTORE_STATE = /Restore state/;
vi.mock("devframe/in-page-channel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("devframe/in-page-channel")>();
  return {
    ...actual,
    connectPanelChannel: (options: Parameters<typeof actual.connectPanelChannel>[0]) => {
      const pair = new MessageChannel();
      if (!host) throw new Error("Test channel is not ready");
      host.channel.addPanelPort(pair.port1);
      return actual.connectPanelChannel({ ...options, window: false, transport: pair.port2 });
    },
  };
});
afterEach(() => {
  cleanup();
  host?.close();
  host = undefined;
});

it("inspects values, records changes and restores application state through real channel calls", async () => {
  const store = createStore();
  const count = atom(0);
  count.debugLabel = "countAtom";
  const doubled = atom((get) => get(count) * 2);
  doubled.debugLabel = "doubledAtom";
  const runtime = new RuntimeController();
  const detach = runtime.attach(store, { name: "Application" });
  const unsub = store.sub(doubled, () => {});
  host = createRuntimeChannel(runtime, false);
  render(<App />);
  try {
    await screen.findByText("Connected");
    fireEvent.click(await screen.findByRole("button", { name: COUNT_ATOM }));
    await screen.findByRole("heading", { name: "countAtom" });
    fireEvent.click(screen.getByRole("button", { name: TIMELINE_TAB }));
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await screen.findByRole("button", { name: "Stop recording" });
    await act(async () => {
      store.set(count, 1);
      store.set(count, 2);
    });
    await waitFor(() => expect(runtime.getState().stores[0]!.history).toHaveLength(3));
    fireEvent.click(await screen.findByRole("button", { name: FIRST_SNAPSHOT }));
    fireEvent.click(await screen.findByRole("button", { name: RESTORE_STATE }));
    await waitFor(() => expect(store.get(count)).toBe(0));
    expect(store.get(doubled)).toBe(0);
    expect(runtime.getState().stores[0]!.history).toHaveLength(3);
  } finally {
    detach();
    unsub();
  }
});
