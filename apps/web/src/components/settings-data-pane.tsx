import * as React from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { AlertTriangle, Loader2 } from "lucide-react";

import { SettingsRow } from "./settings-row";
import { Button } from "./vendor/button";
import { Input } from "./vendor/input";
import { Alert, AlertDescription } from "./vendor/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./vendor/dialog";
import { errorDetail } from "../lib/errors";
import { resetEverything } from "../lib/data-reset";

/**
 * Settings -> data: the danger zone. One destructive action that wipes the
 * server db, model caches, browser storage and every saved setting, gated by
 * a typed confirmation, then reloads into first-run state.
 */
export function DataPane() {
  const intl = useIntl();
  const word = intl.formatMessage({ id: "settings.data.confirmWord" });
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await resetEverything();
      window.location.assign("/");
    } catch (err) {
      setError(errorDetail(intl, err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="space-y-1 rounded-lg border border-destructive/40 p-3">
        <SettingsRow
          title={intl.formatMessage({ id: "settings.data.reset" })}
          description={intl.formatMessage({ id: "settings.data.resetDesc" })}
        >
          <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
            <FormattedMessage id="settings.data.resetButton" />
          </Button>
        </SettingsRow>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) {
            setTyped("");
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <FormattedMessage id="settings.data.confirmTitle" />
            </DialogTitle>
            <DialogDescription>
              <FormattedMessage id="settings.data.confirmDesc" values={{ word }} />
            </DialogDescription>
          </DialogHeader>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label={intl.formatMessage({ id: "settings.data.confirmLabel" })}
            autoComplete="off"
          />
          {error && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              <FormattedMessage id="history.clearCancel" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || typed.trim().toLowerCase() !== word.toLowerCase()}
              onClick={() => void reset()}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              <FormattedMessage id="settings.data.resetDo" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
