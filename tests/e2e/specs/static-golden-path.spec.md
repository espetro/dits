# e2e: static public-site golden path

Covers the public static deployment's first-run path: the landing CTA goes
straight to `/setup`, the client-only runtime completes an interview with
typed input, and finish auto-builds the report through the BYO provider. The
provider endpoint is mocked through `page.route`; the static origin's
`/api/*` and `/v1/*` surface is di server API surface even though the static
file server answers it with the SPA fallback, so the spec asserts it is never
requested.

## di-hosted landing keeps direct setup path without install ui

On the di-hosted build the landing **grill me** CTA navigates directly to
`/setup`. The public install/download control does not render and no install
dialog opens.

## landing to report runs client-only without di server api calls

Seed the public-site runtime override plus a mocked BYO llm profile. Open the
static copy's landing page, follow **grill me** to `/setup`, start a scenario,
type one answer, end the interview through the confirm dialog, and let finish
auto-build the report. Assert the mocked agent reply and report render, the
provider's own `/v1/chat/completions` endpoint was called, and no request
went to `/api/*` or same-origin `/v1/*` on either the static or di server
origin.
