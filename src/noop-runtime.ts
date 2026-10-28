import type { AttachJotaiStoreOptions, Store } from "./types";

export function attachJotaiStore(_store: Store, _options?: AttachJotaiStoreOptions): () => void {
  return () => {};
}
