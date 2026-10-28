import { act, cleanup, render, renderHook } from "@testing-library/react";
import { Provider } from "jotai/react";
import { atom, createStore, getDefaultStore } from "jotai/vanilla";
import { StrictMode, type ReactNode } from "react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  JotaiDevtools,
  useAtomDevtools,
  useAtomsDebugValue,
  useAtomsDevtools,
  useAtomsSnapshot,
  useGotoAtomsSnapshot,
} from "../src/index";

afterEach(async () => {
  cleanup();
  await act(async () => {
    await Promise.resolve();
  });
  delete (window as unknown as Record<string, unknown>).__REDUX_DEVTOOLS_EXTENSION__;
  vi.unstubAllEnvs();
});

describe("compatible React bindings", () => {
  it("renders no inspector DOM or styles, including in Strict Mode", () => {
    const store = createStore();
    const styles = document.querySelectorAll("style, link[rel=stylesheet]").length;
    const view = render(
      <StrictMode>
        <Provider store={store}>
          <JotaiDevtools />
          <span>Application</span>
        </Provider>
      </StrictMode>,
    );
    expect(view.container.innerHTML).toBe("<span>Application</span>");
    expect(document.querySelectorAll("style, link[rel=stylesheet]")).toHaveLength(styles);
  });
  it("uses the nearest Provider and gives an explicit store precedence", () => {
    const outer = createStore();
    const inner = createStore();
    const count = atom(0);
    const unsubOuter = outer.sub(count, () => {});
    const unsubInner = inner.sub(count, () => {});
    outer.set(count, 1);
    inner.set(count, 2);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={outer}>
        <Provider store={inner}>{children}</Provider>
      </Provider>
    );
    const context = renderHook(() => useAtomsSnapshot(), { wrapper });
    const explicit = renderHook(() => useAtomsSnapshot({ store: outer }), { wrapper });
    expect(context.result.current.values.get(count)).toBe(2);
    expect(explicit.result.current.values.get(count)).toBe(1);
    unsubOuter();
    unsubInner();
  });
  it("supports provider-less snapshots, private filtering, and snapshot navigation", async () => {
    const store = getDefaultStore();
    const count = atom(0);
    const hidden = atom(1);
    hidden.debugPrivate = true;
    const unsub = store.sub(count, () => {});
    const unsubPrivate = store.sub(hidden, () => {});
    const view = renderHook(() => ({ snapshot: useAtomsSnapshot(), goto: useGotoAtomsSnapshot() }));
    expect(view.result.current.snapshot.values.get(count)).toBe(0);
    expect(view.result.current.snapshot.values.has(hidden)).toBe(false);
    const original = view.result.current.snapshot;
    await act(async () => {
      store.set(count, 5);
    });
    expect(view.result.current.snapshot.values.get(count)).toBe(5);
    await act(async () => {
      view.result.current.goto(original);
    });
    expect(store.get(count)).toBe(0);
    const privateView = renderHook(() => useAtomsSnapshot({ shouldShowPrivateAtoms: true }));
    expect(privateView.result.current.values.get(hidden)).toBe(1);
    unsub();
    unsubPrivate();
  });
  it("does not connect disabled hooks and tolerates an absent Redux extension", () => {
    const connect = vi.fn();
    Object.assign(window, { __REDUX_DEVTOOLS_EXTENSION__: { connect } });
    const store = createStore();
    const count = atom(0);
    renderHook(() => {
      useAtomsDebugValue({ store, enabled: false });
      useAtomDevtools(count, { store, enabled: false });
      useAtomsDevtools("disabled", { store, enabled: false });
    });
    expect(connect).not.toHaveBeenCalled();
    delete (window as unknown as Record<string, unknown>).__REDUX_DEVTOOLS_EXTENSION__;
    expect(() => renderHook(() => useAtomDevtools(count, { store }))).not.toThrow();
  });
  it("returns empty/no-op production bindings", () => {
    vi.stubEnv("NODE_ENV", "production");
    const store = createStore();
    const count = atom(7);
    const view = renderHook(() => ({
      snapshot: useAtomsSnapshot({ store }),
      goto: useGotoAtomsSnapshot({ store }),
    }));
    expect(view.result.current.snapshot.values.size).toBe(0);
    view.result.current.goto({ values: new Map([[count, 20]]), dependents: new Map() });
    expect(store.get(count)).toBe(7);
  });
});

type ReduxMessage = { type: string; payload?: unknown; state?: string };
function reduxFixture() {
  let listener: (message: ReduxMessage) => void = () => {};
  const unsubscribe = vi.fn();
  const connection = {
    init: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn((next: typeof listener) => {
      listener = next;
      return unsubscribe;
    }),
  };
  const extension = { connect: vi.fn(() => connection), disconnect: vi.fn() };
  Object.assign(window, { __REDUX_DEVTOOLS_EXTENSION__: extension });
  return {
    connection,
    extension,
    unsubscribe,
    dispatch(message: ReduxMessage) {
      listener(message);
    },
  };
}

describe("Redux Devtools interoperability", () => {
  it("keeps recording after a jump to the already-current single-atom value", async () => {
    const redux = reduxFixture();
    const store = createStore();
    const count = atom(0);
    renderHook(() => useAtomDevtools(count, { store }));
    const sent = redux.connection.send.mock.calls.length;
    await act(async () => {
      redux.dispatch({ type: "DISPATCH", payload: { type: "JUMP_TO_STATE" }, state: "0" });
    });
    await act(async () => {
      store.set(count, 1);
    });
    expect(redux.connection.send).toHaveBeenCalledTimes(sent + 1);
  });
  it("handles single-atom actions, jumps, commits and imports with isolated cleanup", async () => {
    const redux = reduxFixture();
    const store = createStore();
    const count = atom(0);
    count.debugLabel = "counter";
    const view = renderHook(() => useAtomDevtools(count, { store, name: "Example" }));
    expect(redux.extension.connect).toHaveBeenCalledWith({ name: "Example" });
    await act(async () => {
      redux.dispatch({ type: "ACTION", payload: "5" });
    });
    expect(store.get(count)).toBe(5);
    const sends = redux.connection.send.mock.calls.length;
    await act(async () => {
      redux.dispatch({ type: "DISPATCH", payload: { type: "JUMP_TO_STATE" }, state: "2" });
    });
    expect(store.get(count)).toBe(2);
    expect(redux.connection.send).toHaveBeenCalledTimes(sends);
    act(() => redux.dispatch({ type: "DISPATCH", payload: { type: "COMMIT" } }));
    expect(redux.connection.init).toHaveBeenLastCalledWith(2);
    await act(async () => {
      redux.dispatch({
        type: "DISPATCH",
        payload: {
          type: "IMPORT_STATE",
          nextLiftedState: { computedStates: [{ state: 0 }, { state: 9 }] },
        },
      });
    });
    expect(store.get(count)).toBe(9);
    view.unmount();
    expect(redux.unsubscribe).toHaveBeenCalledTimes(1);
    expect(redux.connection.disconnect).toHaveBeenCalledTimes(1);
    expect(redux.extension.disconnect).not.toHaveBeenCalled();
  });
  it("handles whole-store jumps, recording pauses and commits", async () => {
    const redux = reduxFixture();
    const store = createStore();
    const count = atom(0);
    const unsub = store.sub(count, () => {});
    renderHook(() => useAtomsDevtools("All atoms", { store }));
    await act(async () => {
      store.set(count, 1);
    });
    expect(redux.connection.send).toHaveBeenCalledTimes(1);
    await act(async () => {
      redux.dispatch({ type: "DISPATCH", payload: { type: "JUMP_TO_ACTION", actionId: 0 } });
    });
    expect(store.get(count)).toBe(0);
    act(() => redux.dispatch({ type: "DISPATCH", payload: { type: "PAUSE_RECORDING" } }));
    await act(async () => {
      store.set(count, 2);
    });
    expect(redux.connection.send).toHaveBeenCalledTimes(1);
    act(() => redux.dispatch({ type: "DISPATCH", payload: { type: "COMMIT" } }));
    expect(redux.connection.init).toHaveBeenCalledTimes(2);
    unsub();
  });
});
