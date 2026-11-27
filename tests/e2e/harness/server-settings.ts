import { DI_URL } from "./env";

/** Clear server-owned provider overrides so independent specs do not leak a control-plane mutation. */
export async function resetServerProviderSettings(): Promise<void> {
  await Promise.all(
    (["llm", "stt", "tts"] as const).map((section) =>
      fetch(`${DI_URL}/v1/provider-settings/${section}`, { method: "DELETE" }).catch(
        () => undefined,
      ),
    ),
  );
}
