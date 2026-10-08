import * as React from "react";
import { useIntl } from "react-intl";
import { Ear, MessageSquare, Volume2 } from "lucide-react";

import { Separator } from "./vendor/separator";
import { HearingSection } from "./settings-hearing-section";
import { BrainSection } from "./settings-brain-section";
import { VoiceSection } from "./settings-voice-section";

function SectionHeading(props: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-2 pl-1 pt-1">
      {props.icon}
      <div>
        <p className="text-sm font-medium">{props.title}</p>
        <p className="text-xs text-muted-foreground">{props.desc}</p>
      </div>
    </div>
  );
}

/**
 * Settings -> voice & personality: the three interview layers, each
 * independently configurable — Hearing (mic + stt), Brain (llm), Voice
 * (tts). Sub-panes for downloads, advanced endpoints and the interviewer
 * ai picker live here now as per-layer conditionals.
 */
export function VoicePane() {
  const intl = useIntl();
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionHeading
          icon={<Ear className="size-4 text-muted-foreground" aria-hidden="true" />}
          title={intl.formatMessage({ id: "settings.section.hearing" })}
          desc={intl.formatMessage({ id: "settings.section.hearingDesc" })}
        />
        <HearingSection />
      </section>
      <Separator />
      <section className="space-y-2">
        <SectionHeading
          icon={<MessageSquare className="size-4 text-muted-foreground" aria-hidden="true" />}
          title={intl.formatMessage({ id: "settings.section.brain" })}
          desc={intl.formatMessage({ id: "settings.section.brainDesc" })}
        />
        <BrainSection />
      </section>
      <Separator />
      <section className="space-y-2">
        <SectionHeading
          icon={<Volume2 className="size-4 text-muted-foreground" aria-hidden="true" />}
          title={intl.formatMessage({ id: "settings.section.voice" })}
          desc={intl.formatMessage({ id: "settings.section.voiceDesc" })}
        />
        <VoiceSection />
      </section>
    </div>
  );
}
