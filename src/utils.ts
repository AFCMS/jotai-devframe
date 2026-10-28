import "./internal/bootstrap";
import { useAtomValue, useStore } from "jotai/react";
import type { Atom, WritableAtom } from "jotai/vanilla";
import {
  useCallback,
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { trackStore } from "./internal/adapter";
import type { AnyAtom, AtomsSnapshot, SnapshotOptions, Store, StoreOptions } from "./types";

const EMPTY: AtomsSnapshot = { values: new Map(), dependents: new Map() };
const noop = () => {};
const noSubscribe = () => noop;
const getEmpty = () => EMPTY;

function snapshotObserver(store: Store, showPrivate: boolean, enabled: boolean) {
  if (!enabled) return { subscribe: noSubscribe, getSnapshot: getEmpty };
  const tracker = trackStore(store);
  let cached = tracker.snapshot(showPrivate);
  let epochs = new Map([...tracker.atoms].map((a) => [a, tracker.read(a)?.n]));
  const update = () => {
    const next = tracker.snapshot(showPrivate);
    const nextEpochs = new Map([...tracker.atoms].map((a) => [a, tracker.read(a)?.n]));
    const changed =
      next.values.size !== cached.values.size ||
      next.dependents.size !== cached.dependents.size ||
      [...nextEpochs].some(([a, n]) => epochs.get(a) !== n) ||
      nextEpochs.size !== epochs.size ||
      [...next.dependents].some(([a, ds]) => {
        const old = cached.dependents.get(a);
        return !old || old.size !== ds.size || [...ds].some((d) => !old.has(d));
      });
    if (changed) {
      cached = next;
      epochs = nextEpochs;
    }
    return changed;
  };
  return {
    subscribe(this: void, listener: () => void) {
      const unsubscribe = tracker.subscribe(() => {
        if (update()) listener();
      });
      if (update()) listener();
      return unsubscribe;
    },
    getSnapshot: () => cached,
  };
}

function useObservedSnapshot(options: SnapshotOptions = {}, enabled = true): AtomsSnapshot {
  const store = useStore(options);
  const active = enabled && process.env.NODE_ENV !== "production" && typeof window !== "undefined";
  const observer = useMemo(
    () => snapshotObserver(store, options.shouldShowPrivateAtoms ?? false, active),
    [store, options.shouldShowPrivateAtoms, active],
  );
  return useSyncExternalStore(observer.subscribe, observer.getSnapshot, getEmpty);
}

export function useAtomsSnapshot(options?: SnapshotOptions): AtomsSnapshot {
  if (process.env.NODE_ENV === "production") return EMPTY;
  return useObservedSnapshot(options);
}

export function useGotoAtomsSnapshot(options?: StoreOptions): (snapshot: AtomsSnapshot) => void {
  if (process.env.NODE_ENV === "production") return noop;
  const store = useStore(options);
  return useCallback(
    (snapshot) => {
      if (process.env.NODE_ENV !== "production" && typeof window !== "undefined")
        trackStore(store).restore(snapshot.values);
    },
    [store],
  );
}

export function useAtomsDebugValue(options?: StoreOptions & { enabled?: boolean }): void {
  if (process.env.NODE_ENV === "production") return;
  const snapshot = useObservedSnapshot(
    { ...options, shouldShowPrivateAtoms: true },
    options?.enabled ?? true,
  );
  const store = useStore(options);
  useDebugValue(snapshot, (value) => {
    if (
      process.env.NODE_ENV === "production" ||
      typeof window === "undefined" ||
      options?.enabled === false
    )
      return {};
    const tracker = trackStore(store);
    return Object.fromEntries(
      [...value.dependents].map(([a, dependents]) => [
        a.debugLabel || String(a),
        {
          ...(tracker.read(a) && "e" in tracker.read(a)!
            ? { error: tracker.read(a)?.e }
            : { value: value.values.get(a) }),
          dependents: [...dependents].map((d) => d.debugLabel || String(d)),
        },
      ]),
    );
  });
}

interface ReduxMessage {
  type: string;
  state?: string;
  payload?:
    | string
    | {
        type?: string;
        actionId?: number;
        nextLiftedState?: { computedStates?: { state: unknown }[] };
      };
}
interface ReduxConnection {
  init: (state: unknown) => void;
  send: (action: unknown, state: unknown) => void;
  subscribe: (listener: (message: ReduxMessage) => void) => (() => void) | undefined;
  unsubscribe?: () => void;
  disconnect?: () => void;
}
interface ReduxExtension {
  connect: (options: { name: string }) => ReduxConnection;
}
function reduxExtension(enabled = true): ReduxExtension | undefined {
  if (!enabled || process.env.NODE_ENV === "production" || typeof window === "undefined") return;
  return (window as typeof window & { __REDUX_DEVTOOLS_EXTENSION__?: ReduxExtension })
    .__REDUX_DEVTOOLS_EXTENSION__;
}
function closeRedux(connection: ReduxConnection, unsubscribe?: () => void): void {
  unsubscribe?.();
  if (connection.disconnect) connection.disconnect();
  else connection.unsubscribe?.();
}
function printable(a: AnyAtom): string {
  return a.debugLabel ? `${String(a)}:${a.debugLabel}` : String(a);
}
function reduxState(snapshot: AtomsSnapshot) {
  return {
    values: Object.fromEntries([...snapshot.values].map(([a, value]) => [printable(a), value])),
    dependents: Object.fromEntries(
      [...snapshot.dependents].map(([a, ds]) => [printable(a), [...ds].map(printable)]),
    ),
  };
}

export function useAtomDevtools<Value, Result>(
  anAtom: WritableAtom<Value, [Value], Result> | Atom<Value>,
  options?: Parameters<typeof useAtomValue>[1] & { name?: string; enabled?: boolean },
): void {
  // Environment is fixed for the lifetime of an application. Production's
  // branch deliberately doesn't subscribe to the target atom.
  if (process.env.NODE_ENV === "production") return;
  const store = useStore(options);
  const value = useAtomValue(anAtom, options);
  const extension = reduxExtension(options?.enabled);
  const name = options?.name || anAtom.debugLabel || String(anAtom);
  const connection = useRef<ReduxConnection | undefined>(undefined);
  const lastValue = useRef(value);
  const traveling = useRef(false);
  lastValue.current = value;
  useEffect(() => {
    if (!extension) return;
    const current = extension.connect({ name });
    connection.current = current;
    current.init(lastValue.current);
    const write = (next: unknown) => {
      if (!("write" in anAtom)) {
        console.warn("[jotai-devframe] Cannot write to a read-only atom.");
        return false;
      }
      const before = store.get(anAtom);
      store.set(anAtom as WritableAtom<Value, [Value], Result>, next as Value);
      return !Object.is(store.get(anAtom), before);
    };
    const off = current.subscribe((message) => {
      try {
        if (message.type === "ACTION" && typeof message.payload === "string")
          write(JSON.parse(message.payload));
        if (message.type !== "DISPATCH" || !message.payload || typeof message.payload !== "object")
          return;
        const payload = message.payload;
        if (
          (payload.type === "JUMP_TO_ACTION" || payload.type === "JUMP_TO_STATE") &&
          message.state
        ) {
          traveling.current = write(JSON.parse(message.state));
        } else if (payload.type === "COMMIT") current.init(lastValue.current);
        else if (payload.type === "IMPORT_STATE") {
          for (const [index, entry] of (payload.nextLiftedState?.computedStates ?? []).entries()) {
            if (!index) current.init(entry.state);
            else write(entry.state);
          }
        }
      } catch (error) {
        console.error("[jotai-devframe] Invalid Redux Devtools action", error);
      }
    });
    return () => {
      connection.current = undefined;
      closeRedux(current, off);
    };
  }, [extension, name, anAtom, store]);
  useEffect(() => {
    if (traveling.current) {
      traveling.current = false;
      return;
    }
    connection.current?.send(`${name} - ${new Date().toLocaleString()}`, value);
  }, [value, name, extension]);
}

export function useAtomsDevtools(
  name: string,
  options?: SnapshotOptions & { enabled?: boolean },
): void {
  if (process.env.NODE_ENV === "production") return;
  const snapshot = useObservedSnapshot(options, options?.enabled ?? true);
  const goto = useGotoAtomsSnapshot(options);
  const extension = reduxExtension(options?.enabled);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const connection = useRef<ReduxConnection | undefined>(undefined);
  const history = useRef<AtomsSnapshot[]>([]);
  const recording = useRef(true);
  const traveling = useRef(false);
  useEffect(() => {
    if (!extension) return;
    const current = extension.connect({ name });
    connection.current = current;
    history.current = [latest.current];
    current.init(reduxState(latest.current));
    const off = current.subscribe((message) => {
      if (message.type !== "DISPATCH" || !message.payload || typeof message.payload !== "object")
        return;
      const payload = message.payload;
      if (payload.type === "COMMIT") {
        history.current = [latest.current];
        current.init(reduxState(latest.current));
      } else if (payload.type === "PAUSE_RECORDING") recording.current = !recording.current;
      else if (payload.type === "JUMP_TO_ACTION" || payload.type === "JUMP_TO_STATE") {
        const next = history.current[payload.actionId ?? -1];
        if (!next) {
          console.warn("[jotai-devframe] Redux snapshot is no longer available.");
          return;
        }
        traveling.current = [...next.values].some(
          ([a, value]) => "init" in a && !Object.is(latest.current.values.get(a), value),
        );
        goto(next);
      }
    });
    return () => {
      history.current = [];
      connection.current = undefined;
      closeRedux(current, off);
    };
  }, [extension, name, goto]);
  useEffect(() => {
    if (traveling.current) {
      traveling.current = false;
      return;
    }
    if (!connection.current || !recording.current || history.current.at(-1) === snapshot) return;
    history.current.push(snapshot);
    connection.current.send(
      { type: String(history.current.length - 1), updatedAt: new Date().toLocaleString() },
      reduxState(snapshot),
    );
  }, [snapshot]);
}

export type { AtomsSnapshot, SnapshotOptions } from "./types";
