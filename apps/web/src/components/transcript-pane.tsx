import { Conversation, ConversationContent, ConversationScrollButton } from "./vendor/conversation";
import { Message, MessageContent } from "./vendor/message";
import { useIntl } from "react-intl";
import type { IntlShape } from "react-intl";
import type { TurnDto } from "../lib/api";

/** Localized `speaker · source` caption for a transcript turn. */
export function turnTag(intl: IntlShape, t: { speaker: string; source: string }): string {
  const who =
    t.speaker === "agent" || t.speaker === "user"
      ? intl.formatMessage({ id: `transcript.who.${t.speaker}` })
      : t.speaker;
  const src =
    t.source === "voice" || t.source === "text"
      ? intl.formatMessage({ id: `transcript.source.${t.source}` })
      : t.source;
  return `${who} · ${src}`;
}

/**
 * Transcript stream: flat speaker rows on the vendored AI Elements
 * conversation primitives (stick-to-bottom scrolling replaces the bespoke
 * scroll plumbing). `speaker · source` stays the row label — typed turns go
 * through the same agent pipeline as speech.
 */
export function TranscriptPane({
  turns,
}: {
  turns: Pick<TurnDto, "id" | "speaker" | "source" | "text">[] | undefined;
}) {
  const intl = useIntl();
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="gap-2.5 px-0.5 py-3">
        {(turns ?? []).map((t) => (
          <Message
            key={t.id}
            from={t.speaker === "agent" ? "assistant" : "user"}
            className="ml-0 max-w-none flex-row items-baseline justify-start gap-2"
          >
            <span className="w-20 shrink-0 whitespace-nowrap pt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-espresso-faint">
              {turnTag(intl, t)}
            </span>
            <MessageContent className="w-full text-sm leading-relaxed text-espresso group-[.is-assistant]:text-espresso-soft group-[.is-user]:ml-0 group-[.is-user]:rounded-none group-[.is-user]:bg-transparent group-[.is-user]:px-0 group-[.is-user]:py-0">
              {t.text}
            </MessageContent>
          </Message>
        ))}
      </ConversationContent>
      <ConversationScrollButton className="border-hairline bg-paper text-espresso shadow-md hover:bg-cream-deep" />
    </Conversation>
  );
}
