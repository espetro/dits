import { describe, expect, it } from "vitest";
import {
  llmDraftFromServer,
  serverPatchFromDraft,
  sttDraftFromServer,
  ttsDraftFromServer,
} from "./server-provider-settings";

const draft = {
  enabled: true,
  flavor: "openai" as const,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-5",
  voice: "",
  llmMode: "remote" as const,
};

describe("server provider settings conversion", () => {
  it("hydrates redacted server sections with a blank key field", () => {
    expect(
      llmDraftFromServer({
        provider: "openai",
        base_url: "https://api.openai.com/v1",
        api_key_set: true,
        model: "gpt-5",
      }),
    ).toMatchObject({ baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-5" });
    expect(
      sttDraftFromServer({
        provider: "remote",
        base_url: "https://api.openai.com/v1",
        api_key_set: true,
        model: "whisper-1",
      }),
    ).toMatchObject({ model: "whisper-1" });
    expect(
      ttsDraftFromServer({
        provider: "remote",
        base_url: "https://api.openai.com/v1",
        api_key_set: true,
        model: "tts-1",
        voice: "alloy",
      }),
    ).toMatchObject({ voice: "alloy" });
  });

  it("omits a blank key when the server already has one", () => {
    expect(serverPatchFromDraft("llm", draft, true)).toEqual({
      provider: "openai",
      flavor: "openai",
      base_url: "https://api.openai.com/v1",
      model: "gpt-5",
    });
  });

  it("clears inherited keys when blank and none is stored", () => {
    expect(serverPatchFromDraft("llm", draft, false)).toMatchObject({ api_key: null });
  });

  it("uses a newly typed key and maps tts voice clearing", () => {
    expect(
      serverPatchFromDraft("tts", { ...draft, apiKey: "sk-new", model: "tts-1" }, true),
    ).toEqual({
      provider: "remote",
      base_url: "https://api.openai.com/v1",
      model: "tts-1",
      api_key: "sk-new",
      voice: null,
    });
  });

  it("does not autosave incomplete drafts", () => {
    expect(serverPatchFromDraft("llm", { ...draft, model: "" }, true)).toBeNull();
    expect(serverPatchFromDraft("stt", { ...draft, enabled: false }, true)).toBeNull();
  });
});
