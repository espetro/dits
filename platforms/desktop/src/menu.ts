import { ApplicationMenu, Utils } from "electrobun/bun";

import { appUrl } from "./server";

export function setupApplicationMenu(): void {
  ApplicationMenu.on("application-menu-clicked", (event) => {
    if ((event as { action?: string }).action !== "open-di") return;
    const url = appUrl();
    if (url) Utils.openExternal(url);
  });

  ApplicationMenu.setApplicationMenu([
    {
      label: "di.",
      submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "togglefullscreen" }],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [{ label: "Open di in Browser", action: "open-di" }],
    },
  ]);
}
