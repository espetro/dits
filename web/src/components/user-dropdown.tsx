import { History, Settings, SlidersHorizontal } from "lucide-react";
import { FormattedMessage } from "react-intl";

import { openSettings } from "./settings-dialog";
import { LocaleSwitcher } from "./locale-switcher";
import { Avatar, AvatarFallback } from "./vendor/avatar";
import { Button } from "./vendor/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./vendor/dropdown-menu";

/**
 * Account dropdown, brioso-style: avatar trigger, glass menu with a header
 * block (guest identity), a Language row reusing the LocaleSwitcher, and
 * History / Settings items that open the settings dialog at the matching
 * pane via URL search params (?settings=1&pane=…).
 */
export function UserDropdown() {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="account"
            className="size-8 rounded-full bg-card/60 p-0 hover:bg-accent"
          >
            <SlidersHorizontal className="size-4 text-espresso" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="w-[calc(100vw-2rem)] min-w-[22rem] max-w-[22rem] rounded-xl border-border/70 bg-popover p-1.5 shadow-2xl"
        >
          <div className="flex items-start gap-3 px-2 py-2">
            <Avatar className="size-9">
              <AvatarFallback className="text-xs font-semibold">G</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">
                <FormattedMessage id="account.guest" />
              </p>
              <p className="truncate text-xs text-muted-foreground">
                <FormattedMessage id="account.guestEmail" />
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 px-2 py-2">
            <span className="text-xs font-medium">
              <FormattedMessage id="account.language" />
            </span>
            <LocaleSwitcher />
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer rounded-lg px-2.5 py-2.5"
            onSelect={(event) => {
              event.preventDefault();
              openSettings("history");
            }}
          >
            <History className="size-4" aria-hidden="true" />
            <FormattedMessage id="account.history" />
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer rounded-lg px-2.5 py-2.5"
            onSelect={(event) => {
              event.preventDefault();
              openSettings("settings");
            }}
          >
            <Settings className="size-4" aria-hidden="true" />
            <FormattedMessage id="account.settings" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
