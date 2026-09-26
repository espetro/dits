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
import { $voiceDownload, $voiceModelsConsent } from "../stores/voice";
import { downloadVoiceModels, wasmVoiceSupported } from "../lib/voice/models";

/**
 * One-shot consent gate for on-device voice (browser mode): accept starts
 * the wasm model download; decline keeps the built-in engines and is never
 * re-asked — Settings -> voice re-arms it via the on-device pickers.
 */
export function VoiceConsentDialog() {
  const intl = useIntl();
  const consent = useStore($voiceModelsConsent);
  const download = useStore($voiceDownload);
  const [open, setOpen] = React.useState(false);
  const supported = React.useMemo(() => wasmVoiceSupported(), []);

  React.useEffect(() => {
    if (supported && consent === "") setOpen(true);
  }, [supported, consent]);

  const downloading = download.status === "downloading";

  const accept = () => {
    $voiceModelsConsent.set("granted");
    // phase c wires engines; the download itself is independent of them.
    void downloadVoiceModels().catch(() => {
      toast.error(intl.formatMessage({ id: "settings.voice.downloadFailed" }));
    });
    setOpen(false);
  };

  const decline = () => {
    $voiceModelsConsent.set("declined");
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // dismissing without a decision keeps consent unset; we re-ask on
        // the next browser-mode entry but never nag within the session.
        setOpen(next);
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
