// Keep every dependency on Jotai's unstable Rev4 internals in this module.
import { atom, INTERNAL_overrideCreateStore } from "jotai/vanilla";
import {
  INTERNAL_buildStoreRev4,
  INTERNAL_getBuildingBlocksRev4,
  INTERNAL_initializeStoreHooksRev4,
  type INTERNAL_AtomState,
  type INTERNAL_Mounted,
} from "jotai/vanilla/internals";

import type { AnyAtom, AtomsSnapshot, Store } from "../types";

export interface StoreTracker {
  atoms: Set<AnyAtom>;
  complete: boolean;
  read: (atom: AnyAtom) => INTERNAL_AtomState | undefined;
  mounted: (atom: AnyAtom) => INTERNAL_Mounted | undefined;
  subscribe: (listener: () => void) => () => void;
  snapshot: (showPrivate?: boolean) => AtomsSnapshot;
  restore: (values: Iterable<readonly [AnyAtom, unknown]>) => void;
  notify: () => void;
}
interface AdapterState {
  installed: boolean;
  trackers: WeakMap<Store, StoreTracker>;
}
const key = Symbol.for("@afcms/jotai-devframe/adapter-v1");
const globals = globalThis as typeof globalThis & { [key]?: WeakMap<object, AdapterState> };
function adapterState(): AdapterState {
  const adapters = (globals[key] ??= new WeakMap());
  let state = adapters.get(INTERNAL_getBuildingBlocksRev4);
  if (!state) {
    state = { installed: false, trackers: new WeakMap() };
    adapters.set(INTERNAL_getBuildingBlocksRev4, state);
  }
  return state;
}

export function isPrivate(atom: AnyAtom): boolean {
  return atom.debugPrivate === true;
}

export function trackStore(store: Store, complete = false): StoreTracker {
  const state = adapterState();
  const previous = state.trackers.get(store);
  if (previous) return previous;
  let blocks: ReturnType<typeof INTERNAL_getBuildingBlocksRev4>;
  try {
    blocks = INTERNAL_getBuildingBlocksRev4(store);
  } catch {
    throw new Error(
      "Jotai Devtools requires a Jotai 3.0.1 store from the same Jotai installation as the devtools.",
    );
  }
  const hooks = INTERNAL_initializeStoreHooksRev4(blocks.h);
  const atoms = new Set<AnyAtom>();
  const listeners = new Set<() => void>();
  let queued = false;
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error("[jotai-devframe] observer failed", error);
      }
    }
  };
  const schedule = () => {
    if (queued || !listeners.size) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      notify();
    });
  };
  hooks.m.add(undefined, (a) => {
    atoms.add(a);
    schedule();
  });
  hooks.u.add(undefined, (a) => {
    atoms.delete(a);
    schedule();
  });
  hooks.r.add(undefined, (a) => {
    // Late attachment can discover existing mounted atoms on subsequent reads.
    if (!atoms.has(a) && blocks.m.has(a)) {
      atoms.add(a);
      schedule();
    }
  });
  hooks.c.add(undefined, schedule);
  hooks.f.add(schedule);

  const originalSet = store.set;
  const originalGet = store.get;
  store.get = (...args) => {
    try {
      return originalGet(...args);
    } finally {
      if (!atoms.has(args[0]) && blocks.m.has(args[0])) {
        atoms.add(args[0]);
        schedule();
      }
    }
  };
  let writeDepth = 0;
  store.set = (...args) => {
    ++writeDepth;
    try {
      return originalSet(...args);
    } finally {
      if (--writeDepth === 0) notify();
    }
  };

  const tracker: StoreTracker = {
    atoms,
    complete,
    read: (a) => blocks.a.get(a),
    mounted: (a) => blocks.m.get(a),
    notify,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot(showPrivate = false) {
      const values: AtomsSnapshot["values"] = new Map();
      const dependents: AtomsSnapshot["dependents"] = new Map();
      for (const a of atoms) {
        if (!showPrivate && isPrivate(a)) continue;
        const value = blocks.a.get(a);
        if (value && "v" in value) values.set(a, value.v);
        const mounted = blocks.m.get(a);
        if (mounted)
          dependents.set(a, new Set([...mounted.t].filter((d) => showPrivate || !isPrivate(d))));
      }
      return { values, dependents };
    },
    restore(values) {
      // A separate building-block view shares the store's maps and hooks. Only
      // this restore transaction bypasses custom primitive write functions.
      const entries = [...values].filter(([a]) => "init" in a);
      const restoreAtom = atom(null, (_get, set) => {
        for (const [a, value] of entries) set(a as ReturnType<typeof atom<unknown>>, value);
      });
      const restoreBlocks = {
        ...blocks,
        W: ((b, s, a, get, set, ...args) =>
          !Object.is(a, restoreAtom) && "init" in a
            ? set(a, ...args)
            : blocks.W(b, s, a, get, set, ...args)) as typeof blocks.W,
      };
      try {
        restoreBlocks.s(restoreBlocks, store, restoreAtom);
      } finally {
        notify();
      }
    },
  };
  state.trackers.set(store, tracker);
  return tracker;
}

export function installInstrumentation(force = false): void {
  if (process.env.NODE_ENV === "production" || (!force && typeof window === "undefined")) return;
  const state = adapterState();
  if (state.installed) return;
  state.installed = true;
  INTERNAL_overrideCreateStore((previous) => () => {
    const store = (previous ?? INTERNAL_buildStoreRev4)();
    trackStore(store, true);
    return store;
  });
}
