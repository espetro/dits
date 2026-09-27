import * as React from "react";
import { useIntl } from "react-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogContent as VendorDialogContent,
} from "./vendor/dialog";

export {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};

/**
 * Vendor DialogContent with a localized sr-only close label — the vendored
 * file ships a hardcoded "Close" and must not be edited.
 */
export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof VendorDialogContent>) {
  const intl = useIntl();
  return (
    <VendorDialogContent className={className} showCloseButton={false} {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <XIcon />
          <span className="sr-only">{intl.formatMessage({ id: "a11y.close" })}</span>
        </DialogPrimitive.Close>
      )}
    </VendorDialogContent>
  );
}
