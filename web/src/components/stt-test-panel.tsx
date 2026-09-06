import { FormattedMessage, useIntl } from "react-intl";

import { $micDeviceId } from "../stores/devices";
import { MicSelector } from "./vendor/mic-selector";
import { Textarea } from "./vendor/textarea";

/**
 * STT section body shared by in-browser and custom modes: the mic selector
 * (bound to the global device store, synced with the /setup mic check) plus
 * a read-aloud test block with a read-only live transcript for in-browser.
 */
export function SttTestPanel(props: { inBrowser: boolean; output: string }) {
  const intl = useIntl();
  return (
    <>
      <div className="space-y-1.5">
        <span className="block text-xs text-muted-foreground">
          <FormattedMessage id="settings.stt.micLabel" />
        </span>
        <MicSelector value={$micDeviceId.get()} onValueChange={(id) => $micDeviceId.set(id)} />
        <span className="mt-1 block text-xs text-muted-foreground">
          <FormattedMessage id="settings.stt.micHelp" />
        </span>
      </div>

      {props.inBrowser && (
        <div className="space-y-3 rounded-lg bg-muted/40 p-3">
          <div>
            <p className="text-sm font-medium">
              <FormattedMessage id="settings.stt.readTitle" />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <FormattedMessage id="settings.stt.readHelp" />
            </p>
          </div>
          <Textarea
            readOnly
            value={props.output}
            placeholder={intl.formatMessage({ id: "settings.stt.readPlaceholder" })}
            rows={3}
            className="resize-none bg-white text-sm"
            aria-label={intl.formatMessage({ id: "settings.stt.readTitle" })}
          />
        </div>
      )}
    </>
  );
}
