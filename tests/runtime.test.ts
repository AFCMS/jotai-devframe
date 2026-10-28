import { atom, createStore } from "jotai/vanilla";
import { INTERNAL_buildStoreRev4 } from "jotai/vanilla/internals";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installInstrumentation, trackStore } from "../src/internal/adapter";
import { RuntimeController } from "../src/internal/controller";

installInstrumentation(true);
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await Promise.resolve();
  vi.useRealTimers();
});
function fixture(options: Parameters<RuntimeController["attach"]>[1] = {}) {
  const store = createStore();
  const count = atom(0);
  count.debugLabel = "count";
  const doubled = atom((get) => get(count) * 2);
  doubled.debugLabel = "doubled";
  cleanups.push(store.sub(doubled, () => {}));
  const runtime = new RuntimeController();
  cleanups.push(runtime.attach(store, options));
  const summary = runtime.getState().stores[0]!;
  return {
    store,
    count,
    doubled,
    runtime,
    target: { sessionId: runtime.sessionId, storeId: summary.id },
    summary: () => runtime.getState().stores[0]!,
  };
}

describe("Jotai runtime", () => {
  it("discovers dependencies without mounting additional atoms", () => {
    const store = createStore();
    const a = atom(1);
    const mount = vi.fn();
    a.onMount = mount;
    const runtime = new RuntimeController();
    cleanups.push(runtime.attach(store));
    expect(runtime.getState().stores[0]!.atoms).toEqual([]);
    expect(mount).not.toHaveBeenCalled();
    cleanups.push(store.sub(a, () => {}));
    expect(runtime.getState().stores[0]!.atoms).toHaveLength(1);
    expect(mount).toHaveBeenCalledTimes(1);
  });
  it("records each completed write, restores primitives, and recomputes derived values", async () => {
    const f = fixture();
    f.runtime.setRecording({ ...f.target, recording: true });
    f.store.set(f.count, 1);
    f.store.set(f.count, 2);
    await Promise.resolve();
    expect(f.summary().history).toHaveLength(3);
    const first = f.summary().history[0]!;
    f.runtime.restoreSnapshot({ ...f.target, snapshotId: first.id });
    await Promise.resolve();
    expect(f.store.get(f.count)).toBe(0);
    expect(f.store.get(f.doubled)).toBe(0);
    expect(f.summary().history).toHaveLength(3);
    expect(f.summary().selectedSnapshotId).toBe(first.id);
  });
  it("bypasses custom primitive writes only during restoration", () => {
    const f = fixture();
    const calls = vi.fn();
    const custom = atom(3, (_get, set, next: number) => {
      calls();
      set(custom, next * 2);
    });
    cleanups.push(f.store.sub(custom, () => {}));
    f.runtime.setRecording({ ...f.target, recording: true });
    f.store.set(custom, 5);
    expect(f.store.get(custom)).toBe(10);
    f.runtime.restoreSnapshot({ ...f.target, snapshotId: f.summary().history[0]!.id });
    expect(f.store.get(custom)).toBe(3);
    expect(calls).toHaveBeenCalledTimes(1);
    f.store.set(custom, 4);
    expect(f.store.get(custom)).toBe(8);
  });
  it("bounds history, freezes display values, and rejects evicted and stale commands", () => {
    const f = fixture({ options: { snapshotHistoryLimit: 2 } });
    f.runtime.setRecording({ ...f.target, recording: true });
    const evicted = f.summary().history[0]!.id;
    f.store.set(f.count, 1);
    f.store.set(f.count, 2);
    expect(f.summary().history).toHaveLength(2);
    expect(() => f.runtime.getSnapshot({ ...f.target, snapshotId: evicted })).toThrow("evicted");
    expect(() => f.runtime.clearHistory({ ...f.target, sessionId: "old-session" })).toThrow(
      "expired",
    );
    const object = atom({ value: 1 });
    cleanups.push(f.store.sub(object, () => {}));
    f.store.set(object, { value: 2 });
    const id = f
      .summary()
      .atoms.find((a) => a.id !== f.summary().atoms[0]!.id && a.type === "object")!.id;
    const snapshotId = f.summary().history.at(-1)!.id;
    f.store.get(object).value = 99;
    expect(
      f.runtime.getSnapshot({ ...f.target, snapshotId }).values[id]!.entries![0]!.value.text,
    ).toBe("2");
    f.runtime.restoreSnapshot({ ...f.target, snapshotId });
    expect(f.store.get(object).value).toBe(2);
  });
  it("shows private atoms and errors without making them public by default", () => {
    const f = fixture();
    const hidden = atom("secret");
    hidden.debugPrivate = true;
    const failure = atom(() => {
      throw new Error("broken");
    });
    failure.debugLabel = "failure";
    cleanups.push(
      f.store.sub(hidden, () => {}),
      f.store.sub(failure, () => {}),
    );
    expect(f.summary().atoms.find((a) => a.label === "failure")?.status).toBe("error");
    expect(trackStore(f.store).snapshot().values.has(hidden)).toBe(false);
    expect(trackStore(f.store).snapshot(true).values.get(hidden)).toBe("secret");
  });
  it("distinguishes a fulfilled undefined promise from a pending promise", async () => {
    const f = fixture();
    let resolve!: (value: undefined) => void;
    const pending = atom(
      new Promise<undefined>((r) => {
        resolve = r;
      }),
    );
    pending.debugLabel = "pending";
    cleanups.push(f.store.sub(pending, () => {}));
    f.runtime.setRecording({ ...f.target, recording: true });
    expect(f.summary().atoms.find((a) => a.label === "pending")!.status).toBe("pending");
    resolve(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.summary().atoms.find((a) => a.label === "pending")!.status).toBe("fulfilled");
    expect(f.summary().history).toHaveLength(2);
  });
  it("does not invoke accessors while recording or restoring opaque values", () => {
    const f = fixture();
    const getter = vi.fn(() => "secret");
    const value = Object.defineProperty({}, "accessor", { get: getter, enumerable: true });
    const a = atom(value);
    cleanups.push(f.store.sub(a, () => {}));
    f.runtime.setRecording({ ...f.target, recording: true });
    const first = f.summary().history[0]!;
    expect(first.referenceValues).toBe(1);
    f.runtime.restoreSnapshot({ ...f.target, snapshotId: first.id });
    expect(getter).not.toHaveBeenCalled();
  });
  it("isolates stores and reference counts duplicate registrations", async () => {
    const f = fixture();
    const duplicate = f.runtime.attach(f.store, { name: "duplicate" });
    const second = createStore();
    cleanups.push(
      second.sub(f.count, () => {}),
      f.runtime.attach(second, { name: "Second" }),
    );
    second.set(f.count, 100);
    expect(f.store.get(f.count)).toBe(0);
    expect(f.runtime.getState().stores).toHaveLength(2);
    duplicate();
    duplicate();
    await Promise.resolve();
    expect(f.runtime.getState().stores).toHaveLength(2);
  });
  it("ignores settlements from replaced promises and preserves duplicate labels", async () => {
    const f = fixture();
    let resolveOld!: (value: string) => void;
    const first = new Promise<string>((r) => {
      resolveOld = r;
    });
    const current = atom(first);
    current.debugLabel = "duplicate";
    const other = atom(1);
    other.debugLabel = "duplicate";
    cleanups.push(
      f.store.sub(current, () => {}),
      f.store.sub(other, () => {}),
    );
    f.runtime.setRecording({ ...f.target, recording: true });
    f.store.set(current, new Promise<string>(() => {}));
    const length = f.summary().history.length;
    resolveOld("obsolete");
    await Promise.resolve();
    await Promise.resolve();
    expect(f.summary().history).toHaveLength(length);
    expect(
      new Set(
        f
          .summary()
          .atoms.filter((a) => a.label === "duplicate")
          .map((a) => a.id),
      ).size,
    ).toBe(2);
  });
  it("retains identity across immediate detach/reattach and applies changed options", async () => {
    const f = fixture();
    f.runtime.setRecording({ ...f.target, recording: true });
    f.store.set(f.count, 1);
    f.store.set(f.count, 2);
    // The first fixture disposer is this registration; simulates an effect refresh.
    const originalDetach = cleanups[cleanups.length - 1]!;
    originalDetach();
    const detach = f.runtime.attach(f.store, {
      name: "Renamed",
      options: { snapshotHistoryLimit: 1 },
    });
    cleanups.push(detach);
    await Promise.resolve();
    expect(f.summary().id).toBe(f.target.storeId);
    expect(f.summary().name).toBe("Renamed");
    expect(f.summary().history).toHaveLength(1);
  });
  it("marks late attachment as incomplete and discovers later mounts", () => {
    const store = INTERNAL_buildStoreRev4();
    const old = atom(1);
    cleanups.push(store.sub(old, () => {}));
    const runtime = new RuntimeController();
    cleanups.push(runtime.attach(store));
    expect(runtime.getState().stores[0]!.complete).toBe(false);
    expect(runtime.getState().stores[0]!.atoms).toHaveLength(0);
    store.get(old);
    expect(runtime.getState().stores[0]!.atoms).toHaveLength(1);
  });
  it("plays centrally without recording feedback and stops after disconnection", () => {
    vi.useFakeTimers();
    const f = fixture({ options: { timeTravelPlaybackInterval: 100 } });
    f.runtime.setRecording({ ...f.target, recording: true });
    f.store.set(f.count, 1);
    f.store.set(f.count, 2);
    f.runtime.setPlayback({ ...f.target, playing: true });
    expect(f.store.get(f.count)).toBe(0);
    vi.advanceTimersByTime(100);
    expect(f.store.get(f.count)).toBe(1);
    expect(f.summary().history).toHaveLength(3);
    f.runtime.setPanelCount(0);
    vi.advanceTimersByTime(500);
    expect(f.store.get(f.count)).toBe(1);
    expect(f.summary().playing).toBe(false);
  });
});
