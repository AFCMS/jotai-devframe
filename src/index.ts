import "./internal/bootstrap";
import { useStore } from "jotai/react";
import { useEffect } from "react";

import { attachJotaiStore } from "./runtime";
import type { JotaiDevtoolsProps } from "./types";

/** Registers a store for inspection. Renders no DOM and imports no CSS. */
export function JotaiDevtools({
  store: explicitStore,
  enabled = true,
  name,
  options,
}: JotaiDevtoolsProps = {}): null {
  if (process.env.NODE_ENV === "production") return null;
  const store = useStore({ store: explicitStore });
  const {
    shouldShowPrivateAtoms,
    shouldExpandJsonTreeViewInitially,
    timeTravelPlaybackInterval,
    snapshotHistoryLimit,
  } = options ?? {};
  useEffect(() => {
    if (!enabled) return;
    return attachJotaiStore(store, {
      name,
      options: {
        ...(shouldShowPrivateAtoms !== undefined ? { shouldShowPrivateAtoms } : {}),
        ...(shouldExpandJsonTreeViewInitially !== undefined
          ? { shouldExpandJsonTreeViewInitially }
          : {}),
        ...(timeTravelPlaybackInterval !== undefined ? { timeTravelPlaybackInterval } : {}),
        ...(snapshotHistoryLimit !== undefined ? { snapshotHistoryLimit } : {}),
      },
    });
  }, [
    store,
    enabled,
    name,
    shouldShowPrivateAtoms,
    shouldExpandJsonTreeViewInitially,
    timeTravelPlaybackInterval,
    snapshotHistoryLimit,
  ]);
  return null;
}

export {
  useAtomsSnapshot,
  useGotoAtomsSnapshot,
  useAtomsDebugValue,
  useAtomDevtools,
  useAtomsDevtools,
} from "./utils";

export type {
  JotaiDevtoolsProps,
  DevtoolsOptions,
  AttachJotaiStoreOptions,
  AtomsSnapshot,
  SnapshotOptions,
  Store,
} from "./types";
