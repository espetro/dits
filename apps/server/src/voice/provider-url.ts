/**
 * Normalize an OpenAI-compatible provider base_url for endpoint joining.
 *
 * Configs in the wild use either the server root (`http://localhost:9000`) or
 * the versioned prefix (`http://localhost:9000/v1`, matching the OpenAI SDK
 * convention). Strip a trailing `/v1` and trailing slashes so
 * `providerUrl(base) + "/v1/audio/speech"` is correct for both.
 */
export function providerUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}
