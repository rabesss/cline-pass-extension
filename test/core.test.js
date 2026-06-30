import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProviderConfig,
  CLINE_PASS_API_KEY_ENV_VAR,
  CLINE_PASS_OMP_AGENT_DB_ENV_VAR,
  createStreamClinePass,
  doctorClinePass,
  findClinePassProvider,
  getClinePassApiKey,
  loginClinePass,
  parseCommandArgs,
  readClinePassAccessToken,
  refreshClinePassAuth,
  refreshClinePassCredentials,
  resolveProvidersPath,
  runClinePassCommand,
  verifyClinePass,
} from "../dist/core.js";
import clinePassExtension from "../dist/extension.js";

test("buildProviderConfig registers direct Cline API models", () => {
  const config = buildProviderConfig({ apiKey: "test-token" });

  assert.equal(config.baseUrl, "https://api.cline.bot/api/v1");
  assert.equal(config.apiKey, "test-token");
  assert.equal(config.api, "cline-pass-custom");
  assert.equal(config.authHeader, true);
  assert.equal(typeof config.streamSimple, "function");
  assert.ok(config.models.some(model => model.id === "glm-5.2" && model.wireId === "cline-pass/glm-5.2"));
});

test("buildProviderConfig uses OMP OAuth adapter by default", () => {
  const config = withProcessEnv({ CLINE_PASS_API_KEY: "", CLINE_API_KEY: "", CLINE_PASS_ACCESS_TOKEN: "" }, () =>
    buildProviderConfig(),
  );

  assert.equal(config.apiKey, undefined);
  assert.equal(config.oauth.name, "Cline Pass");
  assert.equal(typeof config.oauth.login, "function");
  assert.equal(typeof config.oauth.refreshToken, "function");
  assert.equal(typeof config.oauth.getApiKey, "function");
});

test("resolveProvidersPath honors Cline env overrides", () => {
  assert.equal(
    resolveProvidersPath({ CLINE_DATA_DIR: "/tmp/cline-data" }),
    path.resolve("/tmp/cline-data/settings/providers.json"),
  );
  assert.equal(resolveProvidersPath({ CLINE_PROVIDERS_JSON: "/tmp/providers.json" }), "/tmp/providers.json");
});

test("findClinePassProvider accepts Cline's provider settings shape", () => {
  const provider = findClinePassProvider(providerSettings("token-1"));

  assert.equal(provider.provider, "cline-pass");
  assert.equal(provider.auth.accessToken, "token-1");
});

test("findClinePassProvider accepts sibling auth shape", () => {
  const provider = findClinePassProvider(providerSettingsWithSiblingAuth("token-1"));

  assert.equal(provider.provider, "cline-pass");
  assert.equal(provider.auth.accessToken, "token-1");
});

test("readClinePassAccessToken reads the existing Cline login without printing metadata", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("token-1")), "utf8");

  const token = await readClinePassAccessToken({ env: { CLINE_PROVIDERS_JSON: source } });

  assert.equal(token, "workos:token-1");
});

test("readClinePassAccessToken also accepts Cline account provider auth", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettingsFor("cline", "token-1")), "utf8");

  const token = await readClinePassAccessToken({ env: { CLINE_PROVIDERS_JSON: source } });

  assert.equal(token, "workos:token-1");
});

test("readClinePassAccessToken prefers Cline account auth over legacy Cline Pass auth", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(
    source,
    JSON.stringify({
      providers: {
        ...providerSettingsFor("cline-pass", "legacy-token").providers,
        ...providerSettingsFor("cline", "account-token").providers,
      },
    }),
    "utf8",
  );

  const token = await readClinePassAccessToken({ env: { CLINE_PROVIDERS_JSON: source } });

  assert.equal(token, "workos:account-token");
});

test("readClinePassAccessToken prefers Cline API key env vars", async () => {
  const token = await readClinePassAccessToken({ env: { CLINE_PASS_API_KEY: "api-key-1" } });

  assert.equal(token, "api-key-1");
});

test("readClinePassAccessToken refreshes and persists expired Cline tokens", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("old-token", Date.now() - 60_000)), "utf8");
  await fs.chmod(source, 0o644);

  const token = await readClinePassAccessToken({
    env: { CLINE_PROVIDERS_JSON: source },
    baseUrl: "https://cline.test/api/v1",
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://cline.test/api/v1/auth/refresh");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), {
        grantType: "refresh_token",
        refreshToken: "refresh-token",
      });
      return jsonResponse({
        success: true,
        data: {
          accessToken: "new-token",
          refreshToken: "new-refresh-token",
          expiresAt: Date.now() + 3_600_000,
          userInfo: { accountId: "acct_new" },
        },
      });
    },
  });

  assert.equal(token, "workos:new-token");
  const stat = await fs.stat(source);
  assert.equal(stat.mode & 0o077, 0);
  const persisted = JSON.parse(await fs.readFile(source, "utf8"));
  const provider = findClinePassProvider(persisted);
  assert.equal(provider.auth.accessToken, "workos:new-token");
  assert.equal(provider.auth.refreshToken, "new-refresh-token");
  assert.equal(provider.auth.accountId, "acct_new");
});

test("refreshClinePassAuth reports refresh failures without token details", async () => {
  await assert.rejects(
    () =>
      refreshClinePassAuth("refresh-token", {
        fetchImpl: async () =>
          jsonResponse({ success: false, message: "invalid refresh refresh-token" }, { status: 401 }),
      }),
    error => {
      assert.match(error.message, /Cline Pass token refresh failed: HTTP 401/);
      assert.equal(error.message.includes("refresh-token"), false);
      return true;
    },
  );
});

test("OMP OAuth adapter signs in with the Cline account device flow", async () => {
  const opened = [];
  const progress = [];
  const requests = [];

  const credentials = await withProcessEnv({
    CLINE_PASS_API_KEY: "",
    CLINE_API_KEY: "",
    CLINE_PASS_IMPORT_LOCAL: "",
    CLINE_PASS_API_BASE: "https://cline.test/api/v1",
    CLINE_PASS_WORKOS_API_BASE: "https://workos.test",
    CLINE_PASS_WORKOS_CLIENT_ID: "client_test",
  }, () =>
    loginClinePass({
      onAuth: async info => {
        opened.push(info);
      },
      onProgress: async message => {
        progress.push(message);
      },
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (url === "https://workos.test/user_management/authorize/device") {
          assert.equal(String(init.body), "client_id=client_test");
          return jsonResponse({
            device_code: "device-code-1",
            user_code: "ABCD-EFGH",
            verification_uri: "https://authkit.cline.test/device",
            verification_uri_complete: "https://authkit.cline.test/device?user_code=ABCD-EFGH",
            expires_in: 300,
            interval: 1,
          });
        }
        if (url === "https://workos.test/user_management/authenticate") {
          const body = new URLSearchParams(String(init.body));
          assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
          assert.equal(body.get("device_code"), "device-code-1");
          assert.equal(body.get("client_id"), "client_test");
          return jsonResponse({
            access_token: "workos-access",
            refresh_token: "workos-refresh",
            token_type: "Bearer",
          });
        }
        if (url === "https://cline.test/api/v1/auth/register") {
          assert.deepEqual(JSON.parse(init.body), {
            accessToken: "workos-access",
            refreshToken: "workos-refresh",
          });
          return jsonResponse({
            success: true,
            data: {
              accessToken: "cline-access",
              refreshToken: "cline-refresh",
              expiresAt: Date.now() + 3_600_000,
              userInfo: { clineUserId: "acct_login" },
            },
          });
        }
        throw new Error(`unexpected url ${url}`);
      },
    }),
  );

  assert.equal(credentials.access, "workos:cline-access");
  assert.equal(credentials.refresh, "cline-refresh");
  assert.equal(getClinePassApiKey(credentials), "workos:cline-access");
  assert.equal(opened[0].url, "https://authkit.cline.test/device?user_code=ABCD-EFGH");
  assert.match(opened[0].instructions, /ABCD-EFGH/);
  assert.equal(progress.some(message => message.includes("Waiting")), true);
  assert.deepEqual(requests.map(request => request.url), [
    "https://workos.test/user_management/authorize/device",
    "https://workos.test/user_management/authenticate",
    "https://cline.test/api/v1/auth/register",
  ]);
});

test("OMP OAuth adapter rejects Cline account login without a refresh token", async () => {
  await assert.rejects(
    () =>
      withProcessEnv({
        CLINE_PASS_API_KEY: "",
        CLINE_API_KEY: "",
        CLINE_PASS_IMPORT_LOCAL: "",
        CLINE_PASS_API_BASE: "https://cline.test/api/v1",
        CLINE_PASS_WORKOS_API_BASE: "https://workos.test",
        CLINE_PASS_WORKOS_CLIENT_ID: "client_test",
      }, () =>
        loginClinePass({
          onAuth: async () => {},
          fetch: async url => {
            if (url === "https://workos.test/user_management/authorize/device") {
              return jsonResponse({
                device_code: "device-code-1",
                user_code: "ABCD-EFGH",
                verification_uri: "https://authkit.cline.test/device",
                expires_in: 300,
                interval: 1,
              });
            }
            if (url === "https://workos.test/user_management/authenticate") {
              return jsonResponse({
                access_token: "workos-access",
                refresh_token: "workos-refresh",
              });
            }
            if (url === "https://cline.test/api/v1/auth/register") {
              return jsonResponse({
                success: true,
                data: {
                  accessToken: "cline-access",
                  expiresAt: Date.now() + 3_600_000,
                  userInfo: { clineUserId: "acct_login" },
                },
              });
            }
            throw new Error(`unexpected url ${url}`);
          },
        }),
      ),
    /did not include a refresh token/,
  );
});

test("OMP OAuth adapter can still prompt for a Cline API key", async () => {
  const credentials = await withProcessEnv({
    CLINE_PASS_API_KEY: "",
    CLINE_API_KEY: "",
    CLINE_PASS_IMPORT_LOCAL: "",
    CLINE_PASS_LOGIN_MODE: "api-key",
  }, () =>
    loginClinePass({
      onAuth: async info => {
        assert.match(info.url, /api-keys/);
      },
      onPrompt: async () => "  'api-key-1'  ",
    }),
  );

  assert.equal(credentials.access, "api-key-1");
  assert.equal(credentials.refresh, "api-key-1");
  assert.equal(getClinePassApiKey(credentials), "api-key-1");
});

test("OMP OAuth adapter can import and refresh local Cline credentials when opted in", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("token-1")), "utf8");

  const credentials = await withProcessEnv({ CLINE_PROVIDERS_JSON: source, CLINE_PASS_IMPORT_LOCAL: "1" }, () => loginClinePass());

  assert.equal(credentials.access, "workos:token-1");
  assert.equal(credentials.refresh, "refresh-token");
  assert.equal(getClinePassApiKey(credentials), "workos:token-1");

  const refreshed = await withProcessEnv({ CLINE_PASS_API_BASE: "https://cline.test/api/v1" }, () =>
    refreshClinePassCredentials({ access: "old-token", refresh: "refresh-token", expires: Date.now() - 60_000 }, {
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://cline.test/api/v1/auth/refresh");
        assert.equal(JSON.parse(init.body).refreshToken, "refresh-token");
        return jsonResponse({
          success: true,
          data: {
            accessToken: "new-token",
            refreshToken: "new-refresh-token",
            expiresAt: Date.now() + 3_600_000,
          },
        });
      },
    }),
  );

  assert.equal(refreshed.access, "workos:new-token");
  assert.equal(refreshed.refresh, "new-refresh-token");
});

test("doctor reports missing and present ClinePass login status", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("token-1")), "utf8");

  const report = await doctorClinePass({ CLINE_PROVIDERS_JSON: source });

  assert.equal(report.ok, true);
  assert.equal(report.checks.some(check => check.name === "access token" && check.ok), true);
  assert.equal(JSON.stringify(report).includes("token-1"), false);
});

test("doctor accepts expired access token when a refresh token is available", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("token-1", Date.now() - 60_000)), "utf8");

  const report = await doctorClinePass({ CLINE_PROVIDERS_JSON: source });

  assert.equal(report.ok, true);
  assert.equal(report.checks.some(check => check.name === "expiry" && check.ok && check.detail.includes("refresh")), true);
});

test("parseCommandArgs handles verify flags", () => {
  assert.deepEqual(parseCommandArgs("verify --model glm-5.2 --json"), {
    command: "verify",
    options: {
      model: "glm-5.2",
      json: true,
    },
  });
});

test("verifyClinePass posts directly to Cline chat completions", async () => {
  let request;
  const report = await verifyClinePass(
    {
      fetchImpl: async (url, init) => {
        request = { url, init };
        return jsonResponse({
          choices: [{ message: { content: "CLINE_PASS_EXTENSION_OK" } }],
        });
      },
    },
    { CLINE_PASS_API_KEY: "token-1" },
  );

  assert.equal(report.ok, true);
  assert.equal(request.url, "https://api.cline.bot/api/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer token-1");
  assert.equal(JSON.parse(request.init.body).model, "cline-pass/glm-5.2");
});

test("verifyClinePass returns a structured failure for non-JSON success responses", async () => {
  const report = await verifyClinePass(
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          throw new Error("not json");
        },
      }),
    },
    { CLINE_PASS_API_KEY: "token-1" },
  );

  assert.equal(report.ok, false);
  assert.match(report.detail, /not valid JSON/);
});

test("verifyClinePass requires explicit local Cline token import", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("token-1")), "utf8");
  let called = false;

  const missing = await verifyClinePass(
    {
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    },
    { CLINE_PROVIDERS_JSON: source, [CLINE_PASS_OMP_AGENT_DB_ENV_VAR]: path.join(tempDir, "missing-agent.db") },
  );

  assert.equal(called, false);
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /No Cline Pass credential/);

  const imported = await verifyClinePass(
    {
      fetchImpl: async (url, init) => {
        called = true;
        assert.equal(init.headers.Authorization, "Bearer workos:token-1");
        return jsonResponse({ choices: [{ message: { content: "CLINE_PASS_EXTENSION_OK" } }] });
      },
    },
    { CLINE_PROVIDERS_JSON: source, CLINE_PASS_IMPORT_LOCAL: "1" },
  );

  assert.equal(imported.ok, true);
});

test("createStreamClinePass maps clean selector ids and streams text deltas", async () => {
  let request;
  const stream = createStreamClinePass({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return sseResponse([
        { choices: [{ delta: { content: "hel" } }] },
        { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } },
      ]);
    },
  })(
    { id: "glm-5.2", provider: "cline-pass", maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { messages: [{ role: "user", content: "hi" }] },
    { apiKey: "api-key-1" },
  );

  const events = [];
  for await (const event of stream) events.push(event);

  assert.equal(request.url, "https://api.cline.bot/api/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer api-key-1");
  assert.equal(JSON.parse(request.init.body).model, "cline-pass/glm-5.2");
  assert.equal(JSON.parse(request.init.body).stream, true);
  assert.deepEqual(events.filter(event => event.type === "text_delta").map(event => event.delta), ["hel", "lo"]);
  assert.equal(events.at(-1).type, "done");
});

test("createStreamClinePass accepts OMP OAuth credential JSON blobs", async () => {
  let request;
  const stream = createStreamClinePass({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return sseResponse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
    },
  })(
    { id: "glm-5.2", provider: "cline-pass", maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { messages: [{ role: "user", content: "hi" }] },
    {
      apiKey: JSON.stringify({
        access: "workos:json-token",
        refresh: "json-refresh-token",
        expires: Date.now() + 3_600_000,
      }),
    },
  );

  const events = [];
  for await (const event of stream) events.push(event);

  assert.equal(request.url, "https://api.cline.bot/api/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer workos:json-token");
  assert.equal(events.at(-1).type, "done");
});

test("createStreamClinePass falls back to saved OMP OAuth credentials when apiKey is a placeholder", async () => {
  if (!hasSqlite3()) return;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const dbPath = await createOmpAuthDb(tempDir, {
    access: "workos:db-token",
    refresh: "db-refresh-token",
    expires: Date.now() + 3_600_000,
  });
  let request;

  await withProcessEnv({
    [CLINE_PASS_OMP_AGENT_DB_ENV_VAR]: dbPath,
    CLINE_PASS_API_KEY: "",
    CLINE_API_KEY: "",
    CLINE_PASS_ACCESS_TOKEN: "",
    CLINE_PASS_IMPORT_LOCAL: "",
  }, async () => {
    const stream = createStreamClinePass({
      fetchImpl: async (url, init) => {
        request = { url, init };
        return sseResponse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
      },
    })(
      { id: "glm-5.2", provider: "cline-pass", maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { messages: [{ role: "user", content: "hi" }] },
      { apiKey: CLINE_PASS_API_KEY_ENV_VAR },
    );

    const events = [];
    for await (const event of stream) events.push(event);
    assert.equal(events.at(-1).type, "done");
  });

  assert.equal(request.url, "https://api.cline.bot/api/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer workos:db-token");
});

test("createStreamClinePass uses injected fetch and base URL for explicit local token import", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("old-token", Date.now() - 60_000)), "utf8");
  const urls = [];

  const events = [];
  await withProcessEnv({ CLINE_PROVIDERS_JSON: source, CLINE_PASS_API_KEY: "", CLINE_API_KEY: "", CLINE_PASS_ACCESS_TOKEN: "", CLINE_PASS_IMPORT_LOCAL: "1" }, async () => {
    const stream = createStreamClinePass({
      baseUrl: "https://cline.test/api/v1",
      fetchImpl: async (url, init) => {
        urls.push(url);
        if (url.endsWith("/auth/refresh")) {
          return jsonResponse({
            success: true,
            data: {
              accessToken: "new-token",
              refreshToken: "new-refresh-token",
              expiresAt: Date.now() + 3_600_000,
            },
          });
        }

        assert.equal(url, "https://cline.test/api/v1/chat/completions");
        assert.equal(init.headers.Authorization, "Bearer workos:new-token");
        return sseResponse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
      },
    })(
      { id: "glm-5.2", provider: "cline-pass", maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { messages: [{ role: "user", content: "hi" }] },
    );

    for await (const event of stream) events.push(event);
  });

  assert.deepEqual(urls, ["https://cline.test/api/v1/auth/refresh", "https://cline.test/api/v1/chat/completions"]);
  assert.equal(events.at(-1).type, "done");
});

test("createStreamClinePass does not use local Cline tokens unless explicitly opted in", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("token-1")), "utf8");
  let called = false;
  const events = [];

  await withProcessEnv({
    CLINE_PROVIDERS_JSON: source,
    [CLINE_PASS_OMP_AGENT_DB_ENV_VAR]: path.join(tempDir, "missing-agent.db"),
    CLINE_PASS_API_KEY: "",
    CLINE_API_KEY: "",
    CLINE_PASS_ACCESS_TOKEN: "",
    CLINE_PASS_IMPORT_LOCAL: "",
  }, async () => {
    const stream = createStreamClinePass({
      fetchImpl: async () => {
        called = true;
        return sseResponse([]);
      },
    })(
      { id: "glm-5.2", provider: "cline-pass", maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { messages: [{ role: "user", content: "hi" }] },
    );

    for await (const event of stream) events.push(event);
  });

  assert.equal(called, false);
  const error = events.find(event => event.type === "error");
  assert.match(error.error.errorMessage, /No Cline Pass credential/);
});

test("createStreamClinePass rejects tool results without a matching assistant tool call", async () => {
  let called = false;
  const stream = createStreamClinePass({
    fetchImpl: async () => {
      called = true;
      return sseResponse([]);
    },
  })(
    { id: "glm-5.2", provider: "cline-pass", maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { messages: [{ role: "tool", toolCallId: "", content: "result" }] },
    { apiKey: "api-key-1" },
  );

  const events = [];
  for await (const event of stream) events.push(event);

  assert.equal(called, false);
  const error = events.find(event => event.type === "error");
  assert.match(error.error.errorMessage, /toolCallId/);
});

test("extension command completions and JSON errors are scoped", async () => {
  const commands = {};
  clinePassExtension({
    setLabel() {},
    registerProvider() {},
    registerCommand(name, command) {
      commands[name] = command;
    },
  });

  assert.equal(commands.clinepass.getArgumentCompletions("verify --model ").some(item => item.value === "glm-5.2"), true);
  assert.equal(
    commands.clinepass.getArgumentCompletions("verify --model glm-5.2 --json").every(item => item.value.startsWith("--")),
    true,
  );

  let notice;
  await commands.clinepass.handler("missing --json", {
    ui: {
      notify(message, level) {
        notice = { message, level };
      },
    },
  });

  assert.equal(notice.level, "error");
  assert.equal(JSON.parse(notice.message).ok, false);
});

test("runClinePassCommand preserves json output preference", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  await fs.writeFile(source, JSON.stringify(providerSettings("token-1")), "utf8");

  const report = await runClinePassCommand("doctor --json", { CLINE_PROVIDERS_JSON: source });

  assert.equal(report.command, "doctor");
  assert.equal(report.json, true);
});

function providerSettings(accessToken, expiresAt = Date.now() + 3_600_000) {
  return providerSettingsFor("cline-pass", accessToken, expiresAt);
}

function providerSettingsFor(providerId, accessToken, expiresAt = Date.now() + 3_600_000) {
  return {
    providers: {
      [providerId]: {
        settings: {
          provider: providerId,
          model: providerId === "cline-pass" ? "cline-pass/glm-5.2" : "cline/glm-5.2",
          auth: {
            accessToken,
            refreshToken: "refresh-token",
            expiresAt,
            accountId: "acct_test",
          },
        },
      },
    },
  };
}

function providerSettingsWithSiblingAuth(accessToken, expiresAt = Date.now() + 3_600_000) {
  return {
    providers: {
      "cline-pass": {
        settings: {
          provider: "cline-pass",
          model: "cline-pass/glm-5.2",
        },
        auth: {
          accessToken,
          refreshToken: "refresh-token",
          expiresAt,
          accountId: "acct_test",
        },
      },
    },
  };
}

function jsonResponse(payload, init = {}) {
  return {
    ok: init.status ? init.status >= 200 && init.status < 300 : true,
    status: init.status || 200,
    async json() {
      return payload;
    },
  };
}

function sseResponse(chunks, init = {}) {
  const encoder = new TextEncoder();
  return {
    ok: init.status ? init.status >= 200 && init.status < 300 : true,
    status: init.status || 200,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    async json() {
      throw new Error("streaming response");
    },
  };
}

function hasSqlite3() {
  const result = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
  return result.status === 0;
}

async function createOmpAuthDb(tempDir, credentials) {
  const dbPath = path.join(tempDir, "agent.db");
  const data = JSON.stringify(credentials).replaceAll("'", "''");
  const sql = `
    CREATE TABLE auth_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      data TEXT NOT NULL,
      disabled_cause TEXT DEFAULT NULL,
      identity_key TEXT DEFAULT NULL,
      created_at INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO auth_credentials (provider, credential_type, data, identity_key, created_at, updated_at)
    VALUES ('cline-pass', 'oauth', '${data}', 'account:test', 1, 2);
  `;
  const result = spawnSync("sqlite3", [dbPath], { input: sql, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return dbPath;
}

function withProcessEnv(overrides, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    const result = callback();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}
