export interface ValueNode {
  kind: string;
  text: string;
  id?: number;
  ref?: number;
  entries?: { key: string; value: ValueNode }[];
  truncated?: number;
}
interface PromiseState {
  status: "pending" | "fulfilled" | "rejected";
  value?: unknown;
}
const promises = new WeakMap<Promise<unknown>, PromiseState>();

export function inspectPromise(promise: Promise<unknown>): PromiseState {
  let state = promises.get(promise);
  if (!state) {
    state = { status: "pending" };
    promises.set(promise, state);
    const target = state;
    try {
      void Promise.prototype.then.call(
        promise,
        (value: unknown) => {
          target.status = "fulfilled";
          target.value = value;
        },
        (reason: unknown) => {
          target.status = "rejected";
          target.value = reason;
        },
      );
    } catch (reason) {
      target.status = "rejected";
      target.value = reason;
    }
  }
  return state;
}

function ownText(value: object, key: string, fallback: string): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : fallback;
}

/** All outgoing values are plain JSON, including references and opaque values. */
export function encodeValue(
  value: unknown,
  options: { depth?: number; entries?: number } = {},
): ValueNode {
  const maxDepth = Math.min(12, Math.max(0, options.depth ?? 6));
  const maxEntries = Math.min(1000, Math.max(1, options.entries ?? 50));
  const seen = new WeakMap<object, number>();
  let count = 0;
  let nextId = 0;
  function visit(current: unknown, depth: number): ValueNode {
    if (++count > 5000) return { kind: "truncated", text: "Inspection budget reached" };
    if (current === null) return { kind: "null", text: "null" };
    const kind = typeof current;
    if (kind === "string") {
      const text = current as string;
      return {
        kind,
        text: JSON.stringify(text.slice(0, 4000)),
        ...(text.length > 4000 ? { truncated: text.length - 4000 } : {}),
      };
    }
    if (kind !== "object" && kind !== "function")
      return { kind, text: String(current as number | boolean | bigint | symbol | undefined) };
    try {
      const object = current as object;
      const ref = seen.get(object);
      if (ref !== undefined) return { kind: "reference", text: `↩ #${ref}`, ref };
      const id = ++nextId;
      seen.set(object, id);
      if (kind === "function")
        return { kind, text: `[Function ${ownText(object, "name", "anonymous")}]`, id };
      if (current instanceof Promise) {
        const state = inspectPromise(current);
        return {
          kind: "promise",
          text: `Promise (${state.status})`,
          id,
          ...(state.status === "pending"
            ? {}
            : {
                entries: [
                  {
                    key: state.status === "rejected" ? "reason" : "value",
                    value: visit(state.value, depth + 1),
                  },
                ],
              }),
        };
      }
      if (current instanceof Date)
        return {
          kind: "date",
          text: Number.isNaN(Date.prototype.getTime.call(current))
            ? "Invalid Date"
            : Date.prototype.toISOString.call(current),
          id,
        };
      if (current instanceof RegExp) {
        const source = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!.call(
          current,
        ) as string;
        const flags = [
          ["hasIndices", "d"],
          ["global", "g"],
          ["ignoreCase", "i"],
          ["multiline", "m"],
          ["dotAll", "s"],
          ["unicode", "u"],
          ["unicodeSets", "v"],
          ["sticky", "y"],
        ]
          .filter(([name]) =>
            Object.getOwnPropertyDescriptor(RegExp.prototype, name!)?.get?.call(current),
          )
          .map(([, flag]) => flag)
          .join("");
        return { kind: "regexp", text: `/${source}/${flags}`, id };
      }
      let pairs: [string, unknown][] = [];
      let size = 0;
      let label = "Object";
      let nodeKind = "object";
      if (current instanceof Map) {
        nodeKind = "map";
        label = "Map";
        size = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!.call(current) as number;
        const iterator = Map.prototype.entries.call(current) as MapIterator<[unknown, unknown]>;
        for (const [k, v] of iterator) {
          if (pairs.length >= maxEntries) break;
          pairs.push([String(pairs.length), { key: k, value: v }]);
        }
      } else if (current instanceof Set) {
        nodeKind = "set";
        label = "Set";
        size = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!.call(current) as number;
        for (const item of Set.prototype.values.call(current) as SetIterator<unknown>) {
          if (pairs.length >= maxEntries) break;
          pairs.push([String(pairs.length), item]);
        }
      } else {
        const array = Array.isArray(current);
        nodeKind = array ? "array" : current instanceof Error ? "error" : "object";
        label = array
          ? "Array"
          : current instanceof Error
            ? ownText(current, "name", "Error")
            : "Object";
        const keys = Reflect.ownKeys(object).filter((k) => !(array && k === "length"));
        size = keys.length;
        for (const key of keys.slice(0, maxEntries)) {
          const d = Object.getOwnPropertyDescriptor(object, key);
          if (!d) continue;
          pairs.push([String(key), "value" in d ? d.value : accessor]);
        }
      }
      const node: ValueNode = { kind: nodeKind, text: `${label} (${size})`, id };
      if (depth >= maxDepth) {
        if (size) node.truncated = size;
        return node;
      }
      node.entries = pairs.map(([key, v]) => ({
        key,
        value:
          v === accessor
            ? { kind: "accessor", text: "[Getter/Setter — not invoked]" }
            : visit(v, depth + 1),
      }));
      if (size > pairs.length) node.truncated = size - pairs.length;
      return node;
    } catch {
      return { kind: "opaque", text: "[Uninspectable object or proxy]" };
    }
  }
  return visit(value, 0);
}
const accessor = Symbol("accessor");

/** Preflight before structuredClone: its ordinary object algorithm runs getters. */
export function cloneRestoreValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let count = 0;
  function check(current: unknown): void {
    if (++count > 5000) throw new Error("Clone budget reached");
    if (typeof current === "function" || typeof current === "symbol")
      throw new Error("Opaque value");
    if (current === null || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    const prototype: unknown = Object.getPrototypeOf(current);
    const supported =
      prototype === Object.prototype ||
      prototype === null ||
      Array.isArray(current) ||
      current instanceof Map ||
      current instanceof Set ||
      current instanceof Date ||
      current instanceof RegExp ||
      current instanceof ArrayBuffer ||
      ArrayBuffer.isView(current);
    if (!supported) throw new Error("Opaque prototype");
    if (current instanceof Map)
      for (const [k, v] of Map.prototype.entries.call(current) as MapIterator<[unknown, unknown]>) {
        check(k);
        check(v);
      }
    if (current instanceof Set)
      for (const v of Set.prototype.values.call(current) as SetIterator<unknown>) check(v);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) throw new Error("Accessor value");
      check(descriptor.value);
    }
  }
  check(value);
  return structuredClone(value);
}

export function formatValue(node: ValueNode, indent = 0): string {
  if (!node.entries?.length) return node.text;
  const padding = "  ".repeat(indent + 1);
  return `${node.text} {\n${node.entries.map((e) => `${padding}${e.key}: ${formatValue(e.value, indent + 1)}`).join(",\n")}\n${"  ".repeat(indent)}}${node.truncated ? ` … ${node.truncated} more` : ""}`;
}

export interface ValueChange {
  path: string;
  before: string | null;
  after: string | null;
}
export function diffValues(
  before: Record<string, ValueNode>,
  after: Record<string, ValueNode>,
): ValueChange[] {
  const changes: ValueChange[] = [];
  function compare(a: ValueNode | undefined, b: ValueNode | undefined, path: string) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a?.kind === b?.kind && a?.entries?.length && b?.entries?.length) {
      const left = new Map(a.entries.map((e) => [e.key, e.value]));
      const right = new Map(b.entries.map((e) => [e.key, e.value]));
      for (const key of new Set([...left.keys(), ...right.keys()]))
        compare(left.get(key), right.get(key), `${path}.${key}`);
    } else
      changes.push({ path, before: a ? formatValue(a) : null, after: b ? formatValue(b) : null });
  }
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)]))
    compare(before[id], after[id], id);
  return changes;
}
