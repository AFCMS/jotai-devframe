import type { Atom, createStore } from "jotai/vanilla";

export type Store = ReturnType<typeof createStore>;
export type AnyAtom = Atom<unknown>;
export type AtomsSnapshot = Readonly<{
  values: Map<AnyAtom, unknown>;
  dependents: Map<AnyAtom, Set<AnyAtom>>;
}>;
export type StoreOptions = { store?: Store };
export type SnapshotOptions = StoreOptions & { shouldShowPrivateAtoms?: boolean };
export interface DevtoolsOptions {
  shouldShowPrivateAtoms?: boolean;
  shouldExpandJsonTreeViewInitially?: boolean;
  timeTravelPlaybackInterval?: number;
  snapshotHistoryLimit?: number;
}
export interface AttachJotaiStoreOptions {
  name?: string;
  options?: DevtoolsOptions;
}
export interface JotaiDevtoolsProps extends AttachJotaiStoreOptions, StoreOptions {
  enabled?: boolean;
}

export const DEFAULT_OPTIONS: Required<DevtoolsOptions> = {
  shouldShowPrivateAtoms: false,
  shouldExpandJsonTreeViewInitially: false,
  timeTravelPlaybackInterval: 750,
  snapshotHistoryLimit: 30,
};

export function resolveOptions(options: DevtoolsOptions = {}): Required<DevtoolsOptions> {
  const result = { ...DEFAULT_OPTIONS, ...options };
  if (
    !(result.snapshotHistoryLimit > 0) ||
    (Number.isFinite(result.snapshotHistoryLimit) && !Number.isInteger(result.snapshotHistoryLimit))
  ) {
    throw new Error("snapshotHistoryLimit must be a positive integer or Infinity");
  }
  if (
    !Number.isFinite(result.timeTravelPlaybackInterval) ||
    result.timeTravelPlaybackInterval < 16
  ) {
    throw new Error("timeTravelPlaybackInterval must be at least 16 ms");
  }
  return result;
}
