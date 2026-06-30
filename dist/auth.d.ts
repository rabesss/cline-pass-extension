import type { ClineProviderAuth, ClineProviderSettings, ClineSettings, Credentials, Env, FoundClineProvider, LoginCallbacks, ReadCredentialsOptions, RefreshCredentialsOptions, RuntimeApiKeyOptions } from "./types.js";
export declare function resolveProvidersPath(env?: Env): string;
export declare function readClinePassAccessToken(options?: ReadCredentialsOptions): Promise<string>;
export declare function readClinePassCredentials(options?: ReadCredentialsOptions): Promise<Credentials>;
export declare function loginClinePass(callbacks?: LoginCallbacks): Promise<Credentials>;
export declare function refreshClinePassCredentials(credentials: Partial<Credentials> | undefined, _options?: RefreshCredentialsOptions): Promise<Credentials>;
export declare function getClinePassApiKey(credentials?: Partial<Credentials>): string;
export declare function readProviderSettings(providersPath: string): Promise<ClineSettings>;
export declare function findClinePassProvider(settings: ClineSettings): (ClineProviderSettings & {
    auth?: ClineProviderAuth;
}) | undefined;
export declare function findClineAuthProviderEntry(settings?: ClineSettings): FoundClineProvider | undefined;
export declare function resolveRuntimeApiKey(options?: RuntimeApiKeyOptions, env?: Env): Promise<string>;
export declare function missingApiKeyMessage(): string;
