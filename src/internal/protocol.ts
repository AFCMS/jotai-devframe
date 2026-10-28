import type { InPageChannelProtocol } from "devframe/in-page-channel";

import type { DevtoolsOptions } from "../types";
import type { ValueChange, ValueNode } from "./values";

export const CHANNEL_NAME = "devframes:plugin:jotai-devtools";
export const PROTOCOL_VERSION = 1;
export interface Target {
  sessionId: string;
  storeId: string;
}
export interface AtomSummary {
  id: string;
  label: string;
  private: boolean;
  primitive: boolean;
  status: "value" | "error" | "pending" | "fulfilled" | "rejected";
  preview: string;
  type: string;
  dependencies: string[];
  dependents: string[];
}
export interface SnapshotSummary {
  id: string;
  timestamp: number;
  changed: number;
  referenceValues: number;
  searchText: string;
}
export interface StoreSummary {
  id: string;
  name: string;
  complete: boolean;
  revision: number;
  atoms: AtomSummary[];
  history: SnapshotSummary[];
  recording: boolean;
  playing: boolean;
  selectedSnapshotId: string | null;
  speed: number;
  options: Required<DevtoolsOptions>;
}
export interface RuntimeState {
  protocolVersion: number;
  sessionId: string;
  stores: StoreSummary[];
}
export interface AtomDetails {
  atom: AtomSummary;
  value: ValueNode;
}
export interface SnapshotDetails extends SnapshotSummary {
  values: Record<string, ValueNode>;
  labels: Record<string, string>;
  privateAtoms: string[];
  changes: ValueChange[];
}
export interface JotaiChannelProtocol extends InPageChannelProtocol {
  functions: {
    pageScript: {
      getInfo: () => { protocolVersion: number; sessionId: string };
      getAtom: (
        input: Target & { atomId: string; entries?: number; depth?: number },
      ) => AtomDetails;
      getSnapshot: (input: Target & { snapshotId: string }) => SnapshotDetails;
      setRecording: (input: Target & { recording: boolean }) => void;
      clearHistory: (input: Target) => void;
      restoreSnapshot: (input: Target & { snapshotId: string }) => void;
      setPlayback: (input: Target & { playing: boolean; speed?: number }) => void;
    };
    panel: Record<never, never>;
  };
  events: { pageScript: Record<never, never>; panel: Record<never, never> };
  sharedStates: { runtime: RuntimeState };
}
