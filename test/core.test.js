import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildProviderConfig,
  doctorClinePass,
  installClinePass,
  runClinePassCommand,
  parseCommandArgs,
  readAuthDirFromConfig,
  uninstallClinePass,
} from "../src/core.js";

test("buildProviderConfig registers CLIProxyAPI Cline Pass models", () => {
  const config = buildProviderConfig({
    CLIPROXY_BASE_URL: "http://localhost:8317",
    CLIPROXY_API_KEY: "test-key",
  });

  assert.equal(config.baseUrl, "http://localhost:8317/v1");
  assert.equal(config.apiKey, "test-key");
  assert.equal(config.api, "openai-completions");
  assert.ok(config.models.some(model => model.id === "cline-pass/glm-5.2"));
});

test("parseCommandArgs handles subcommands and flags", () => {
  assert.deepEqual(parseCommandArgs("install --mode copy --dry-run --auth-dir '/tmp/auth dir'"), {
    command: "install",
    options: {
      mode: "copy",
      dryRun: true,
      authDir: "/tmp/auth dir",
    },
  });
});

test("readAuthDirFromConfig accepts CLIProxyAPI YAML spelling", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const configPath = path.join(tempDir, "config.yaml");
  await fs.writeFile(configPath, "auth-dir: ~/cliproxy-auth\n", "utf8");

  assert.equal(await readAuthDirFromConfig(configPath, { HOME: "/home/test" }), "~/cliproxy-auth");
});

test("install creates a managed symlink and doctor recognizes it", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  const authDir = path.join(tempDir, "auth");
  await fs.writeFile(source, providerSettingsJson("token-1"), "utf8");

  const installed = await installClinePass({ source, authDir });
  assert.equal(installed.ok, true);

  const linkTarget = await fs.readlink(path.join(authDir, "cline-providers.json"));
  assert.equal(linkTarget, source);

  const report = await doctorClinePass({ source, authDir });
  assert.equal(report.ok, true);
});

test("install refuses to overwrite a different target without force", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  const authDir = path.join(tempDir, "auth");
  await fs.mkdir(authDir);
  await fs.writeFile(source, providerSettingsJson("token-1"), "utf8");
  await fs.writeFile(path.join(authDir, "cline-providers.json"), "different", "utf8");

  await assert.rejects(() => installClinePass({ source, authDir }), /exists and differs/);
});

test("copy mode and uninstall remove only matching managed files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  const authDir = path.join(tempDir, "auth");
  const target = path.join(authDir, "cline-providers.json");
  await fs.writeFile(source, providerSettingsJson("token-1"), "utf8");

  await installClinePass({ source, authDir, mode: "copy" });
  assert.equal(await fs.readFile(target, "utf8"), await fs.readFile(source, "utf8"));

  await uninstallClinePass({ source, authDir });
  await assert.rejects(() => fs.lstat(target), /ENOENT/);
});

test("runClinePassCommand preserves json output preference", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-pass-ext-"));
  const source = path.join(tempDir, "providers.json");
  const authDir = path.join(tempDir, "auth");
  await fs.writeFile(source, providerSettingsJson("token-1"), "utf8");

  const report = await runClinePassCommand(`doctor --json --source ${source} --auth-dir ${authDir}`, {
    HOME: tempDir,
  });

  assert.equal(report.command, "doctor");
  assert.equal(report.json, true);
});

function providerSettingsJson(accessToken) {
  return JSON.stringify({
    providers: {
      "cline-pass": {
        settings: {
          provider: "cline-pass",
          auth: {
            accessToken,
            refreshToken: "refresh-token",
            expiresAt: 1780000000,
          },
        },
      },
    },
  });
}
