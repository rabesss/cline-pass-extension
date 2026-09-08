import { CLINE_API_BASE, CLINE_PASS_API_KEY_ENV_VAR, PROVIDER_NAME, RECOMMENDED_MODELS_PATH } from "./constants.js";
import { getClinePassApiKey, loginClinePass, refreshClinePassCredentials } from "./auth.js";
import { fetchDynamicClinePassModels } from "./dynamic-models.js";
import { CLINE_PASS_MODELS } from "./models.js";
import { createStreamClinePass } from "./streaming.js";
import type { BuildProviderOptions, ProviderConfig } from "./types.js";
import { normalizeBaseUrl, stringValue } from "./utils.js";

export function buildProviderConfig(options: BuildProviderOptions = {}): ProviderConfig {
  const baseUrl = stringValue(options.baseUrl) || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE;
  const oauth = options.oauth || {
    name: PROVIDER_NAME,
    login: loginClinePass,
    refreshToken: refreshClinePassCredentials,
    getApiKey: getClinePassApiKey,
  };
  const apiKey = stringValue(options.apiKey) || CLINE_PASS_API_KEY_ENV_VAR;
  return {
    name: PROVIDER_NAME,
    baseUrl,
    apiKey,
    authHeader: true,
    api: "cline-pass-custom",
    streamSimple: options.streamSimple || createStreamClinePass({ ...options, baseUrl, oauth, apiKey }),
    oauth,
    models: CLINE_PASS_MODELS,
    fetchDynamicModels: () => fetchDynamicClinePassModels({
      url: `${normalizeBaseUrl(baseUrl)}${RECOMMENDED_MODELS_PATH}`,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    }),
  };
}
