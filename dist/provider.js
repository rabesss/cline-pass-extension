import { CLINE_API_BASE, PROVIDER_NAME } from "./constants.js";
import { getClinePassApiKey, loginClinePass, refreshClinePassCredentials } from "./auth.js";
import { CLINE_PASS_MODELS } from "./models.js";
import { createStreamClinePass } from "./streaming.js";
import { stringValue } from "./utils.js";
export function buildProviderConfig(options = {}) {
    const baseUrl = stringValue(options.baseUrl) || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE;
    const oauth = options.oauth || {
        name: PROVIDER_NAME,
        login: loginClinePass,
        refreshToken: refreshClinePassCredentials,
        getApiKey: getClinePassApiKey,
    };
    const apiKey = stringValue(options.apiKey);
    const config = {
        name: PROVIDER_NAME,
        baseUrl,
        authHeader: true,
        api: "cline-pass-custom",
        streamSimple: options.streamSimple || createStreamClinePass({ ...options, baseUrl, oauth, apiKey }),
        oauth,
        models: CLINE_PASS_MODELS,
    };
    if (apiKey)
        config.apiKey = apiKey;
    return config;
}
//# sourceMappingURL=provider.js.map