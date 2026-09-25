import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Input } from "./vendor/input";

const fieldClass = "block text-xs text-muted-foreground";
const helperClass = "mt-1 text-xs text-muted-foreground";

/**
 * Label + input + one-line muted helper. Extracted so each endpoint
 * field stays a single declarative row inside the centered column.
 */
export function SettingsField(props: {
  label: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={fieldClass}>{props.label}</span>
      <span className="mt-1 block">{props.children}</span>
      {props.helper && <span className={helperClass}>{props.helper}</span>}
    </label>
  );
}

/** Clickable free-provider links shared by the LLM/STT/TTS helper notes. */
const FREE_PROVIDERS = [
  { name: "OpenRouter", href: "https://openrouter.ai/" },
  { name: "Groq", href: "https://console.groq.com/home" },
  { name: "Cerebras", href: "https://inference.cerebras.ai/" },
  { name: "Google AI Studio", href: "https://aistudio.google.com/" },
];

function FreeProviderLinks() {
  return (
    <>
      {FREE_PROVIDERS.map((p, i) => (
        <React.Fragment key={p.name}>
          {i > 0 && ", "}
          <a
            href={p.href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-persimmon-text"
          >
            {p.name}
          </a>
        </React.Fragment>
      ))}
      {"."}
    </>
  );
}

/**
 * The shared per-section endpoint fields (base URL, redacted API key,
 * model id with a /models datalist, voice for TTS) plus the per-category
 * provider hint block. Extracted from settings-dialog to keep that file
 * under the loc ratchet.
 */
export function EndpointFields(props: {
  tab: "stt" | "tts" | "llm";
  draft: {
    flavor: "openai" | "anthropic";
    baseUrl: string;
    apiKey: string;
    model: string;
    voice: string;
  };
  savedApiKey: string | null;
  modelOptions: string[];
  onChange: (
    patch: Partial<{ baseUrl: string; apiKey: string; model: string; voice: string }>,
  ) => void;
}) {
  const intl = useIntl();
  const tab = props.tab;
  const draft = props.draft;
  return (
    <div className="space-y-4">
      <SettingsField
        label={intl.formatMessage({ id: "settings.baseUrl" })}
        helper={intl.formatMessage({
          id:
            tab === "llm" && draft.flavor === "anthropic"
              ? "settings.baseUrlHelpAnthropic"
              : "settings.baseUrlHelp",
        })}
      >
        <Input
          value={draft.baseUrl}
          onChange={(e) => props.onChange({ baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
      </SettingsField>
      <SettingsField
        label={intl.formatMessage({ id: "settings.apiKey" })}
        helper={intl.formatMessage({ id: "settings.apiKeyHelp" })}
      >
        <Input
          type="password"
          value={draft.apiKey}
          onChange={(e) => props.onChange({ apiKey: e.target.value })}
          placeholder={
            props.savedApiKey
              ? intl.formatMessage({ id: "settings.apiKeySaved" }, { key: props.savedApiKey })
              : ""
          }
        />
      </SettingsField>
      <SettingsField
        label={intl.formatMessage({ id: "settings.modelId" })}
        helper={intl.formatMessage({ id: "settings.modelHelp" })}
      >
        <>
          <Input
            value={draft.model}
            onChange={(e) => props.onChange({ model: e.target.value })}
            list={`${tab}-models`}
            placeholder={
              props.modelOptions.length === 0
                ? intl.formatMessage({ id: "settings.modelPlaceholder" })
                : undefined
            }
          />
          <datalist id={`${tab}-models`}>
            {props.modelOptions.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </>
      </SettingsField>
      {tab === "tts" && (
        <SettingsField
          label={intl.formatMessage({ id: "settings.voice" })}
          helper={intl.formatMessage({ id: "settings.voiceHelp" })}
        >
          <Input value={draft.voice} onChange={(e) => props.onChange({ voice: e.target.value })} />
        </SettingsField>
      )}
      <div className="space-y-1.5 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          <FormattedMessage id={`settings.section.${tab}.title`} />
        </p>
        <p>
          <FormattedMessage id={`settings.section.${tab}.providers`} />
        </p>
        {tab === "llm" && (
          <p>
            <FormattedMessage id="settings.freeProvidersLabel" /> <FreeProviderLinks />
          </p>
        )}
      </div>
    </div>
  );
}
