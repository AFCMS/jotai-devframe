import "./internal/bootstrap";
import { createRuntimeChannel } from "./internal/channel";
import { RuntimeController } from "./internal/controller";
import type { AttachJotaiStoreOptions, Store } from "./types";

const key = Symbol.for("@afcms/jotai-devframe/runtime-v1");
type Runtime = {
  controller: RuntimeController;
  transport?: ReturnType<typeof createRuntimeChannel>;
};
const globals = globalThis as typeof globalThis & { [key]?: Runtime };

export function attachJotaiStore(store: Store, options: AttachJotaiStoreOptions = {}): () => void {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return () => {};
  const runtime = (globals[key] ??= { controller: new RuntimeController() });
  const detach = runtime.controller.attach(store, options);
  runtime.transport ??= createRuntimeChannel(runtime.controller);
  return () => {
    detach();
    queueMicrotask(() => {
      if (runtime.controller.getState().stores.length) return;
      runtime.transport?.close();
      runtime.transport = undefined;
    });
  };
}

export type { AttachJotaiStoreOptions, DevtoolsOptions, Store } from "./types";
