import { nanoid } from "devframe/utils/nanoid";

import type { AnyAtom, AttachJotaiStoreOptions, Store } from "../types";
import { resolveOptions } from "../types";
import { isPrivate, trackStore, type StoreTracker } from "./adapter";
import {
  PROTOCOL_VERSION,
  type AtomDetails,
  type AtomSummary,
  type RuntimeState,
  type SnapshotDetails,
  type StoreSummary,
  type Target,
} from "./protocol";
import {
  cloneRestoreValue,
  diffValues,
  encodeValue,
  inspectPromise,
  type ValueNode,
} from "./values";

interface HistoryEntry {
  details: SnapshotDetails;
  restoreValues: Map<AnyAtom, unknown>;
}
interface RecordState {
  store: Store;
  tracker: StoreTracker;
  summary: StoreSummary;
  references: number;
  history: HistoryEntry[];
  signature: string;
  restoring: boolean;
  unsubscribe: () => void;
  timer?: ReturnType<typeof setInterval>;
  watchedPromises: WeakSet<Promise<unknown>>;
}

/** Framework-free state engine. Nothing here needs a window or a server. */
export class RuntimeController {
  readonly sessionId = nanoid();
  private records = new Map<string, RecordState>();
  private storeIds = new WeakMap<Store, string>();
  private atomIds = new WeakMap<AnyAtom, string>();
  private nextStore = 0;
  private nextAtom = 0;
  private nextSnapshot = 0;
  private panels = 0;
  private listeners = new Set<(state: RuntimeState) => void>();

  private atomId(a: AnyAtom): string {
    let id = this.atomIds.get(a);
    if (!id) {
      id = `a${++this.nextAtom}`;
      this.atomIds.set(a, id);
    }
    return id;
  }

  attach(store: Store, options: AttachJotaiStoreOptions = {}): () => void {
    let id = this.storeIds.get(store);
    if (!id) {
      id = `s${++this.nextStore}`;
      this.storeIds.set(store, id);
    }
    let record = this.records.get(id);
    if (!record) {
      const tracker = trackStore(store);
      record = {
        store,
        tracker,
        references: 0,
        history: [],
        signature: "",
        restoring: false,
        watchedPromises: new WeakSet(),
        unsubscribe: () => {},
        summary: {
          id,
          name: options.name ?? `Store ${this.nextStore}`,
          complete: tracker.complete,
          revision: 0,
          atoms: [],
          history: [],
          recording: false,
          playing: false,
          selectedSnapshotId: null,
          speed: 1,
          options: resolveOptions(options.options),
        },
      };
      const current = record;
      record.unsubscribe = tracker.subscribe(() => {
        if (this.panels || current.summary.recording) {
          if (
            this.refresh(current) &&
            current.summary.recording &&
            !current.restoring &&
            !current.summary.playing
          )
            this.capture(current);
          this.emit();
        }
      });
      this.records.set(id, record);
      this.refresh(record);
    } else if (record.references === 0) {
      // A component can change options while retaining the store and history.
      this.stop(record);
      record.summary = {
        ...record.summary,
        name: options.name ?? record.summary.name,
        options: resolveOptions(options.options),
      };
      const limit = record.summary.options.snapshotHistoryLimit;
      if (record.history.length > limit) record.history.splice(0, record.history.length - limit);
      record.summary = {
        ...record.summary,
        history: record.summary.history.filter((h) =>
          record!.history.some((entry) => entry.details.id === h.id),
        ),
        selectedSnapshotId: record.history.some(
          (entry) => entry.details.id === record!.summary.selectedSnapshotId,
        )
          ? record.summary.selectedSnapshotId
          : null,
      };
    }
    ++record.references;
    this.emit();
    const current = record;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      --current.references;
      // Strict Mode and refresh can re-register the same store in this turn.
      queueMicrotask(() => {
        if (current.references || this.records.get(current.summary.id) !== current) return;
        this.stop(current);
        current.unsubscribe();
        current.history.length = 0;
        this.records.delete(current.summary.id);
        this.emit();
      });
    };
  }

  subscribe(listener: (state: RuntimeState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getState(): RuntimeState {
    for (const record of this.records.values()) this.refresh(record);
    return this.state();
  }
  private state(): RuntimeState {
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      stores: [...this.records.values()].map((r) => ({ ...r.summary })),
    };
  }
  private emit(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }
  setPanelCount(count: number): void {
    this.panels = count;
    if (!count) for (const record of this.records.values()) this.stop(record);
    else for (const record of this.records.values()) this.refresh(record);
    this.emit();
  }
  private target(input: Target): RecordState {
    if (!input || input.sessionId !== this.sessionId)
      throw new Error(
        "This command belongs to an expired page session. Reconnect to the application.",
      );
    const record = this.records.get(input.storeId);
    if (!record) throw new Error("This store is no longer registered.");
    return record;
  }
  private summary(record: RecordState, a: AnyAtom): AtomSummary {
    const state = record.tracker.read(a);
    const value = state && "e" in state ? state.e : state?.v;
    let status: AtomSummary["status"] = state && "e" in state ? "error" : "value";
    if (value instanceof Promise) {
      status = inspectPromise(value).status;
      if (!record.watchedPromises.has(value)) {
        record.watchedPromises.add(value);
        const settle = () => {
          if (this.records.get(record.summary.id) !== record || record.tracker.read(a)?.v !== value)
            return;
          record.tracker.notify();
        };
        try {
          void Promise.prototype.then.call(value, settle, settle);
        } catch {
          /* Opaque Promise proxies are display-only. */
        }
      }
    }
    const preview = encodeValue(value, { depth: 0, entries: 1 });
    return {
      id: this.atomId(a),
      label: a.debugLabel || String(a),
      private: isPrivate(a),
      primitive: "init" in a,
      status,
      type: preview.kind,
      preview: preview.text,
      dependencies: [...(state?.d.keys() ?? [])].filter((d) => d !== a).map((d) => this.atomId(d)),
      dependents: [...(record.tracker.mounted(a)?.t ?? [])].map((d) => this.atomId(d)),
    };
  }
  private refresh(record: RecordState): boolean {
    const atoms = [...record.tracker.atoms].map((a) => this.summary(record, a));
    const signature = JSON.stringify(
      [...record.tracker.atoms].map((a, i) => [atoms[i], record.tracker.read(a)?.n]),
    );
    if (record.signature === signature) return false;
    record.signature = signature;
    record.summary = { ...record.summary, atoms, revision: record.summary.revision + 1 };
    return true;
  }
  private capture(record: RecordState): void {
    const values: Record<string, ValueNode> = {};
    const labels: Record<string, string> = {};
    const privateAtoms: string[] = [];
    const restoreValues = new Map<AnyAtom, unknown>();
    let referenceValues = 0;
    for (const a of record.tracker.atoms) {
      const state = record.tracker.read(a);
      if (!state) continue;
      const id = this.atomId(a);
      labels[id] = a.debugLabel || String(a);
      if (isPrivate(a)) privateAtoms.push(id);
      values[id] = encodeValue("e" in state ? state.e : state.v);
      if ("v" in state && "init" in a) {
        try {
          restoreValues.set(a, cloneRestoreValue(state.v));
        } catch {
          restoreValues.set(a, state.v);
          ++referenceValues;
        }
      }
    }
    const previous = record.history.at(-1)?.details.values ?? {};
    const changes = diffValues(previous, values);
    const details: SnapshotDetails = {
      id: `h${++this.nextSnapshot}`,
      timestamp: Date.now(),
      changed: changes.length,
      referenceValues,
      searchText: [
        ...new Set(changes.map((change) => labels[change.path.split(".")[0]!] ?? "")),
      ].join(" "),
      values,
      labels,
      privateAtoms,
      changes,
    };
    record.history.push({ details, restoreValues });
    const limit = record.summary.options.snapshotHistoryLimit;
    if (record.history.length > limit) record.history.splice(0, record.history.length - limit);
    record.summary = {
      ...record.summary,
      history: record.history.map(({ details: d }) => ({
        id: d.id,
        timestamp: d.timestamp,
        changed: d.changed,
        referenceValues: d.referenceValues,
        searchText: d.searchText,
      })),
      selectedSnapshotId:
        record.summary.selectedSnapshotId &&
        record.history.some((h) => h.details.id === record.summary.selectedSnapshotId)
          ? record.summary.selectedSnapshotId
          : null,
    };
  }
  getAtom(input: Target & { atomId: string; entries?: number; depth?: number }): AtomDetails {
    const record = this.target(input);
    const a = [...record.tracker.atoms].find((atom) => this.atomId(atom) === input.atomId);
    if (!a) throw new Error("This atom is no longer mounted.");
    const state = record.tracker.read(a);
    return {
      atom: this.summary(record, a),
      value: encodeValue(state && "e" in state ? state.e : state?.v, input),
    };
  }
  getSnapshot(input: Target & { snapshotId: string }): SnapshotDetails {
    const record = this.target(input);
    const snapshot = record.history.find((h) => h.details.id === input.snapshotId);
    if (!snapshot) throw new Error("This snapshot has been evicted or cleared.");
    return snapshot.details;
  }
  setRecording(input: Target & { recording: boolean }): void {
    const record = this.target(input);
    if (typeof input.recording !== "boolean") throw new Error("recording must be a boolean");
    if (record.summary.recording === input.recording) return;
    record.summary = { ...record.summary, recording: input.recording };
    if (input.recording) {
      this.refresh(record);
      this.capture(record);
    }
    this.emit();
  }
  clearHistory(input: Target): void {
    const record = this.target(input);
    this.stop(record);
    record.history.length = 0;
    record.summary = { ...record.summary, history: [], selectedSnapshotId: null };
    if (record.summary.recording) {
      this.refresh(record);
      this.capture(record);
    }
    this.emit();
  }
  restoreSnapshot(input: Target & { snapshotId: string }): void {
    const record = this.target(input);
    this.stop(record);
    this.restore(record, input.snapshotId);
  }
  private restore(record: RecordState, snapshotId: string): void {
    const entry = record.history.find((h) => h.details.id === snapshotId);
    if (!entry) throw new Error("This snapshot has been evicted or cleared.");
    record.restoring = true;
    try {
      // Clone again so subsequent application mutations cannot alter history.
      record.tracker.restore(
        [...entry.restoreValues].map(([a, v]) => {
          try {
            return [a, cloneRestoreValue(v)] as const;
          } catch {
            return [a, v] as const;
          }
        }),
      );
      this.refresh(record);
      record.summary = { ...record.summary, selectedSnapshotId: snapshotId };
    } finally {
      record.restoring = false;
      this.emit();
    }
  }
  private stop(record: RecordState): void {
    if (record.timer !== undefined) clearInterval(record.timer);
    record.timer = undefined;
    record.summary = { ...record.summary, playing: false };
  }
  setPlayback(input: Target & { playing: boolean; speed?: number }): void {
    const record = this.target(input);
    if (typeof input.playing !== "boolean") throw new Error("playing must be a boolean");
    const speed = input.speed ?? record.summary.speed;
    if (![0.5, 1, 1.5, 1.75, 2].includes(speed)) throw new Error("Unsupported playback speed");
    this.stop(record);
    record.summary = { ...record.summary, speed };
    if (input.playing && record.history.length) {
      let index = record.history.findIndex(
        (h) => h.details.id === record.summary.selectedSnapshotId,
      );
      if (index < 0 || index === record.history.length - 1) index = -1;
      const step = () => {
        const next = record.history[++index];
        if (!next) {
          this.stop(record);
          this.emit();
          return;
        }
        this.restore(record, next.details.id);
        if (index === record.history.length - 1) {
          this.stop(record);
          this.emit();
        }
      };
      record.summary = { ...record.summary, playing: true };
      // Playback suppresses recording until stopped, preserving its source list.
      record.timer = setInterval(
        step,
        Math.max(16, record.summary.options.timeTravelPlaybackInterval / speed),
      );
      step();
    }
    this.emit();
  }
}
