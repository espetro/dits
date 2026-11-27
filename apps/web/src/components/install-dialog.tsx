import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { Button } from "./vendor/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./vendor/dialog";

const RELEASES_URL = "https://github.com/espetro/dits/releases/latest";
// unpinned so users always get latest; MISE_MINIMUM_RELEASE_AGE=0 bypasses
// mise's built-in 24h release-age gate so a just-tagged release resolves.
const MISE_COMMAND = "MISE_MINIMUM_RELEASE_AGE=0 mise exec github:espetro/dits -- di";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Public-site install chooser behind the secondary landing link. The primary
 * landing path is the in-browser demo itself; this dialog only carries the
 * durable installs (desktop app, mise). Only rendered on the public-site
 * build — the di-served SPA goes straight to /setup and never mounts this.
 */
export function InstallDialog({ open, onOpenChange }: InstallDialogProps) {
  const [copied, setCopied] = useState(false);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(MISE_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard denied: leave the command selectable */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* grid-cols minmax(0,1fr): the vendored content is `grid` — an implicit
          auto track sizes to max-content, and the nowrap mise command inflates
          it past the max-w clamp so children overflow on narrow viewports. */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage
              id="landing.install.title"
              values={{
                em: (chunks: ReactNode) => <em className="italic text-persimmon-deep">{chunks}</em>,
              }}
            />
          </DialogTitle>
          <DialogDescription className="sr-only">
            <FormattedMessage id="landing.install.title" />
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Button asChild className="w-full gap-2">
            <a href={RELEASES_URL} target="_blank" rel="noreferrer">
              <Download aria-hidden="true" />
              <FormattedMessage id="landing.install.download" />
            </a>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            <FormattedMessage id="landing.install.downloadHint" />
          </p>

          <div className="mt-2">
            <p className="mb-2 text-sm font-medium">
              <FormattedMessage id="landing.install.mise" />
            </p>
            <div className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2">
              <code className="flex-1 select-all overflow-x-auto whitespace-nowrap font-mono text-xs">
                {MISE_COMMAND}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={copyCommand}
                aria-label={copied ? "copied" : "copy command"}
              >
                {copied ? (
                  <Check className="size-3.5 text-persimmon-deep" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
