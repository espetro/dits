/** Minimal in-process event sink the voice loop implements against the db. */
export interface EventSink {
  postEvent(sessionId: string, type: string, payload?: unknown): Promise<void>;
}
