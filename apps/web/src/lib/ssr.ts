import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import type { ReadableAtom } from "nanostores";

/**
 * True after mount. Persisted stores (localStorage via @nanostores/persistent)
 * only read real values on the client, so SSR markup is always built from
 * store defaults — any render that reads them directly differs on the first
 * client pass (hydration error #418).
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/**
 * useStore variant that returns `ssrValue` (what SSR saw — the atom's
 * default) for the hydration pass, then swaps to the real persisted value
 * post-mount. Use wherever persisted-atom state feeds SSR-visible markup;
 * the post-mount swap is the standard persisted-state flash.
 */
export function useSsrStore<Value>(store: ReadableAtom<Value>, ssrValue: Value): Value {
  const value = useStore(store);
  return useHydrated() ? value : ssrValue;
}
