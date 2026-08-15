import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(projectDir, "dist/extension.js");

function findOmpBinary() {
  if (process.env.OMP_BIN) return process.env.OMP_BIN;
  const candidates = [
    process.env.HOME ? resolve(process.env.HOME, ".local/bin/omp") : undefined,
    ...(process.env.PATH ?? "").split(delimiter).map(entry => resolve(entry, "omp")),
  ].filter(Boolean);
  for (const candidate of new Set(candidates)) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
    }
  }
  return undefined;
}

function run(binary, args, env, timeoutMs = 30_000) {
  return new Promise(resolveResult => {
    const child = spawn(binary, args, {
      cwd: projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolveResult({ code: -1, stdout, stderr: `${stderr}\nTIMEOUT after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr });
    });
  });
}

const ompBinary = findOmpBinary();

test("real OMP loads the catalog and streams through the built extension", { skip: !ompBinary }, async t => {
  const agentDir = mkdtempSync(join(tmpdir(), "omp-cline-pass-extension-test-"));
  let requestCount = 0;
  let requestBody;
  let authorization = "";
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    requestCount += 1;
    authorization = String(request.headers.authorization ?? "");
    let body = "";
    request.on("data", chunk => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      requestBody = JSON.parse(body);
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "mock-cline-pass-ok" } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });

  t.after(async () => {
    if (server.listening) await new Promise(resolveClose => server.close(resolveClose));
    rmSync(agentDir, { recursive: true, force: true });
  });

  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: agentDir,
    CLINE_PASS_API_BASE: `http://127.0.0.1:${address.port}`,
    CLINE_PASS_API_KEY: "mock-key",
    CLINE_API_KEY: "",
    CLINE_PASS_ACCESS_TOKEN: "",
    CLINE_PASS_IMPORT_LOCAL: "",
  };

  // OMP 16.3.4 suppresses explicitly-passed --extension paths when
  // --no-extensions is present, despite its help text. The fresh
  // PI_CODING_AGENT_DIR above already isolates this run from discovered
  // extensions, so discovery can stay enabled while the built extension is
  // loaded explicitly. See issue #5.
  const listArgs = [
    "models",
    "cline-pass",
    "--extension",
    extensionPath,
  ];
  const list = await run(ompBinary, listArgs, env, 20_000);
  assert.equal(list.code, 0, list.stderr);
  assert.match(list.stdout, /cline-pass/);
  assert.match(list.stdout, /qwen3\.8-max/);
  assert.match(list.stdout, /kimi-k3/);
  assert.match(list.stdout, /kimi-k3\s+.*low,high,max/);
  assert.doesNotMatch(list.stdout, /kimi-k2\.6\s+.*minimal,low,medium,high/);

  const inference = await run(ompBinary, [
    "--extension",
    extensionPath,
    "--no-session",
    "--no-tools",
    "--model",
    "cline-pass/qwen3.8-max",
    "-p",
    "say the mock token",
  ], env);
  assert.equal(inference.code, 0, inference.stderr);
  assert.match(inference.stdout, /mock-cline-pass-ok/);
  assert.equal(requestCount, 1);
  assert.equal(authorization, "Bearer mock-key");
  assert.equal(requestBody.model, "cline-pass/qwen3.8-max");
  assert.equal(requestBody.max_tokens, 16_384);
  assert.equal(requestBody.stream, true);

});
