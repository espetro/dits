import * as React from "react";
import { useStore } from "@nanostores/react";
import { FormattedMessage, useIntl } from "react-intl";
import { Download } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./vendor/dialog";
import { Button } from "./vendor/button";
import { $voiceConsentPrompt, $voiceDownload, $voiceModelsConsent } from "../stores/voice";
import { downloadVoiceModels } from "../lib/voice/models";

/**
 * Consent prompt for on-device voice (~50mb download). Fires at point of
 * need: the first browser-mode interview entry, or picking "on-device" in
 * settings -> voice while consent isn't granted. Accept starts the
 * download; decline keeps the built-in engines (re-arms on the next
 * on-device pick); dismissing leaves consent unset.
 */
export function VoiceConsentDialog() {
  const intl = useIntl();
  const open = useStore($voiceConsentPrompt);
  const download = useStore($voiceDownload);

  const downloading = download.status === "downloading";

  const accept = () => {
    $voiceModelsConsent.set("granted");
    // phase c wires engines; the download itself is independent of them.
    void downloadVoiceModels().catch(() => {
      toast.error(intl.formatMessage({ id: "settings.voicePane.downloadFailed" }));
    });
    $voiceConsentPrompt.set(false);
  };

  const decline = () => {
    $voiceModelsConsent.set("declined");
    $voiceConsentPrompt.set(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // closing without a decision keeps consent unset, so the next
        // point-of-need check re-arms the prompt.
        if (!next) $voiceConsentPrompt.set(false);
      }}
    >
      <DialogContent className="bg-paper">
        <DialogTitle>
          <FormattedMessage id="voiceConsent.title" />
        </DialogTitle>
        <DialogDescription>
          <FormattedMessage id="voiceConsent.body" />
        </DialogDescription>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={decline} className="h-11 rounded-full">
            <FormattedMessage id="voiceConsent.decline" />
          </Button>
          <Button
            onClick={accept}
            disabled={downloading}
            className="h-11 rounded-full bg-espresso text-cream hover:bg-persimmon"
          >
            <Download className="size-4" />
            <FormattedMessage id="voiceConsent.accept" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
