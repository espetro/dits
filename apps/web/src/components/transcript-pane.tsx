import { Conversation, ConversationContent, ConversationScrollButton } from "./vendor/conversation";
import { Message, MessageContent } from "./vendor/message";
import type { TurnDto } from "../lib/api";

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
              {t.speaker} · {t.source}
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
