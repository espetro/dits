import { persistentAtom } from "@nanostores/persistent";

/**
 * Global microphone selection, shared by the /setup mic check and the
 * settings STT pane so both always control the same device.
 */
export const $micDeviceId = persistentAtom<string>("di.mic-device-id", "", {
  encode: (value: string) => value,
  decode: (raw) => raw,
});
