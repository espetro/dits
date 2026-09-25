# Screen: Not found / Error (root fallbacks)

## ASCII mockup

```
+------------------------------------------------------------------+
|                                                                  |
|                      (ambient cream ground)                      |
|                                                                  |
|                             +----+                               |
|                             | !  |   <- error only (icon)        |
|                             +----+                               |
|                                                                  |
|                         4 0 4    <- notfound only, display serif |
|                                                                  |
|                  something went wrong / friendly copy            |
|                  [muted mono block: error message]               |
|                                                                  |
|                    (try again)     back home                     |
|                                                                  |
+------------------------------------------------------------------+
```

## Behavior

- Root-route `notFoundComponent`: big `404` in `font-display` (zero in persimmon), friendly copy, localized "back home" link. Returned with HTTP 404 for unknown paths and invalid locale prefixes.
- Root-route `errorComponent`: warning icon, localized title, the raw error message in a muted mono block, a "try again" button (calls the boundary `reset`, falling back to router invalidate), and a "back home" link.
- Both render in place of the route tree, so each wraps itself in its own `IntlProvider` (URL-derived locale, en fallback) via `ErrorShell` in `apps/web/src/routes/__root.tsx`.
- Locale keys: `error.title` / `error.message` / `error.retry` / `error.home` and `notfound.title` / `notfound.message` / `notfound.home`, with parity across all 10 locales (enforced by `scripts/check-locales.ts`).

## URL / state

- Any unmatched path (with or without a `{-$locale}` prefix). No params, no search state. Home link preserves the current URL locale.
