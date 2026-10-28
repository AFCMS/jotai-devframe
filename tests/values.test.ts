import { describe, expect, it, vi } from "vitest";

import { diffValues, encodeValue, formatValue, inspectPromise } from "../src/internal/values";

describe("transport-safe value inspection", () => {
  it("handles cycles, functions, symbols, bigint and collections as strict JSON", () => {
    const value: Record<string, unknown> = {
      callback() {},
      symbol: Symbol("demo"),
      bigint: 3n,
      map: new Map([["a", new Set([1, 2])]]),
      date: new Date("2026-01-01"),
      error: new Error("oops"),
    };
    value.self = value;
    const encoded = encodeValue(value);
    expect(() => structuredClone(encoded)).not.toThrow();
    expect(() => JSON.parse(JSON.stringify(encoded))).not.toThrow();
    expect(encoded.entries!.find((e) => e.key === "self")!.value.kind).toBe("reference");
    expect(formatValue(encoded)).toContain("[Function callback]");
    expect(formatValue(encoded)).toContain("Map");
    expect(formatValue(encoded)).toContain("oops");
  });
  it("does not execute getters and contains failing proxies", () => {
    const getter = vi.fn(() => {
      throw new Error("should not execute");
    });
    const value = Object.defineProperty({}, "secret", { get: getter });
    expect(encodeValue(value).entries![0]!.value.kind).toBe("accessor");
    expect(getter).not.toHaveBeenCalled();
    expect(
      encodeValue(
        new Proxy(
          {},
          {
            ownKeys() {
              throw new Error("no");
            },
          },
        ),
      ).kind,
    ).toBe("opaque");
  });
  it("bounds deep and wide values and exposes truncation", () => {
    expect(encodeValue(Array.from({ length: 200 }, (_, i) => i)).truncated).toBe(150);
    expect(encodeValue({ nested: { deeper: 1 } }, { depth: 0 }).truncated).toBe(1);
  });
  it("reads RegExp internals without invoking overridden getters", () => {
    const getter = vi.fn(() => {
      throw new Error("not invoked");
    });
    const value = /hello/gi;
    Object.defineProperty(value, "source", { get: getter });
    Object.defineProperty(value, "flags", { get: getter });
    expect(encodeValue(value).text).toBe("/hello/gi");
    expect(getter).not.toHaveBeenCalled();
  });
  it("records promise rejection without creating an unhandled rejection", async () => {
    const promise = Promise.reject(new Error("failed"));
    expect(inspectPromise(promise).status).toBe("pending");
    await Promise.resolve();
    const encoded = encodeValue(promise);
    expect(encoded.text).toBe("Promise (rejected)");
    expect(formatValue(encoded)).toContain("failed");
  });
  it("reports nested changes, additions and deletions", () => {
    const changes = diffValues(
      { a: encodeValue({ x: 1, gone: true }) },
      { a: encodeValue({ x: 2, added: false }) },
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "a.x", before: "1", after: "2" },
        { path: "a.gone", before: "true", after: null },
        { path: "a.added", before: null, after: "false" },
      ]),
    );
  });
});
