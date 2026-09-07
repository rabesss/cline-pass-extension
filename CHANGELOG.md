# Changelog

## Unreleased

- Fetch Cline's public recommended-models roster at runtime and merge live
  Cline Pass ids with the committed `models.json` overlay. New ids become
  selectable automatically; known ids keep overlay limits, reasoning, modalities,
  and pricing. Discovery is Cline Pass only (`free` is ignored). Static models
  remain the cold-start fallback. `models.json` is never auto-written.
- Discover models from the provider base URL, keep overlay display names when
  the live roster omits them, and clone restored overlay metadata.
- Replace the removed personal-dashboard API-key URL with Cline's current
  WorkOS device-authorization flow, including Cline account token exchange and
  refresh support for OMP/Pi `/login` credentials, without repeating the
  browser-confirmation wait message on every authorization poll.
- Replace the hard-coded ten-model list with a reviewed offline catalog derived
  from Cline's live Cline Pass list, official pricing docs, and models.dev.
- Add Qwen3.8 Max and Kimi K3, current context/output limits, reference pricing,
  cache rates, input modalities, and model-specific reasoning effort maps.
- Add OpenAI-compatible image input serialization for vision-capable models and
  explicit placeholders for images sent to text-only models.
- Separate cached and uncached token usage and select context-dependent pricing
  tiers during reference cost accounting.
- Keep a conservative 16,384-token request default while exposing each model's
  current maximum output capability.
- Add read-only catalog drift/proposal commands and scheduled validation.
- Declare `CLINE_PASS_API_KEY` in the OMP provider contract so models remain
  discoverable in fresh profiles while retaining `/login` OAuth credentials.
- Use OMP's current explicit `thinking.efforts` and `max` contracts. Preserve
  source reasoning capability separately so OMP does not invent effort controls
  for models whose upstream catalog only exposes toggle or budget reasoning.
