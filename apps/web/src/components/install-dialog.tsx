import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { FormattedMessage } from "react-intl";
import { Link } from "@tanstack/react-router";
import { Badge } from "./vendor/badge";
import { Button } from "./vendor/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./vendor/dialog";
import { Separator } from "./vendor/separator";
import { useLocale, withLocale } from "../lib/locale-href";

const RELEASES_URL = "https://github.com/espetro/dits/releases/latest";
const MISE_COMMAND = "mise exec github:espetro/dits -- di";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Public-site install chooser shown behind the landing CTA. Options 1-2 are the
 * durable installs (desktop app, mise); a separator visually demotes option 3,
 * the experimental in-browser demo. Only rendered on the IS_PUBLIC_SITE build —
 * the di-served SPA navigates straight to /setup and never mounts this.
 */
export function InstallDialog({ open, onOpenChange }: InstallDialogProps) {
  const locale = useLocale();
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
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage id="landing.install.title" />
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

        <Separator className="my-1" />

        <Button variant="outline" asChild className="w-full gap-2">
          <Link to={withLocale(locale, "/setup")} onClick={() => onOpenChange(false)}>
            <FormattedMessage id="landing.install.demo" />
            <Badge variant="secondary" className="text-[10px] uppercase">
              <FormattedMessage id="landing.install.experimental" />
            </Badge>
          </Link>
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          <FormattedMessage id="landing.install.demoHint" />
        </p>
      </DialogContent>
    </Dialog>
  );
}
