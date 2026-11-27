import * as React from "react";

import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "./vendor/item";

/**
 * Settings row grammar (spotify-style): title + one-line plain-language
 * description on the left, the row's control pinned to the right.
 */
export function SettingsRow(props: {
  title: React.ReactNode;
  description: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Item size="sm" className="px-0">
      <ItemContent className="min-w-48">
        <ItemTitle className="text-sm font-medium">{props.title}</ItemTitle>
        <ItemDescription className="text-xs text-muted-foreground">
          {props.description}
        </ItemDescription>
      </ItemContent>
      {props.children ? (
        <ItemActions className="ml-auto flex-wrap justify-end">{props.children}</ItemActions>
      ) : null}
    </Item>
  );
}
