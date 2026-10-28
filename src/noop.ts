import type { useAtomValue } from "jotai/react";
import type { Atom, WritableAtom } from "jotai/vanilla";

import type { AtomsSnapshot, JotaiDevtoolsProps, SnapshotOptions, StoreOptions } from "./types";

const empty: AtomsSnapshot = { values: new Map(), dependents: new Map() };
const noop = () => {};
export function JotaiDevtools(_props?: JotaiDevtoolsProps): null {
  return null;
}
export function useAtomsSnapshot(_options?: SnapshotOptions): AtomsSnapshot {
  return empty;
}
export function useGotoAtomsSnapshot(_options?: StoreOptions): (snapshot: AtomsSnapshot) => void {
  return noop;
}
export function useAtomsDebugValue(_options?: StoreOptions & { enabled?: boolean }): void {}
export function useAtomDevtools<Value, Result>(
  _atom: WritableAtom<Value, [Value], Result> | Atom<Value>,
  _options?: Parameters<typeof useAtomValue>[1] & { name?: string; enabled?: boolean },
): void {}
export function useAtomsDevtools(
  _name: string,
  _options?: SnapshotOptions & { enabled?: boolean },
): void {}
