/**
 * Installs `ReadableStream[Symbol.asyncIterator]` on browsers that lack it
 * (Chrome <124, Safari <27, Firefox <110 — i.e. most Android webviews and
 * pre-current iOS). Imported for its side effect BEFORE `phonemizer`: the
 * espeak datafile loader inside that bundle consumes its gzip stream with
 * `for await`, and on an unsupported browser the throw happens inside an
 * unobserved async iife — the module init never completes and every
 * `phonemize()` call hangs forever with no error.
 *
 * For-await semantics mirror the spec: pull from a reader until done,
 * release the lock when the loop exits early.
 */
export function installReadableStreamAsyncIterator(): void {
  if (typeof ReadableStream === "undefined") return;
  const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
  if (proto[Symbol.asyncIterator]) return;
  proto[Symbol.asyncIterator] = async function* (
    this: ReadableStream<unknown>,
  ): AsyncGenerator<unknown, void, undefined> {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

installReadableStreamAsyncIterator();
