import {
  buildProviderConfig,
  commandUsage,
  formatCommandResult,
  providerModelSelectors,
  runClinePassCommand,
} from "./core.js";

export default async function clinePassExtension(pi) {
  if (typeof pi.setLabel === "function") pi.setLabel("Cline Pass");

  if (typeof pi.registerProvider === "function") {
    pi.registerProvider("cline-pass", buildProviderConfig());
  }

  pi.registerCommand("clinepass", {
    description: "Manage Cline Pass for CLIProxyAPI",
    getArgumentCompletions: argumentCompletions,
    handler: async (args, ctx) => {
      try {
        const result = await runClinePassCommand(args);
        emit(ctx, formatCommandResult(result, result?.json), result.ok ? "info" : "error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit(ctx, `FAIL clinepass: ${message}\n\n${commandUsage()}`, "error");
      }
    },
  });
}

function emit(ctx, message, level) {
  if (typeof ctx?.ui?.notify === "function") {
    ctx.ui.notify(message, level);
    return;
  }
  console.log(message);
}

function argumentCompletions(prefix) {
  const tokens = prefix.trimStart().split(/\s+/);
  const first = tokens[0] || "";
  if (!prefix.includes(" ") && first) {
    return ["doctor", "install", "uninstall", "verify", "help"]
      .filter(value => value.startsWith(first))
      .map(value => ({ value, label: value }));
  }
  if (!prefix.includes(" ")) {
    return ["doctor", "install", "uninstall", "verify", "help"].map(value => ({ value, label: value }));
  }

  const last = tokens[tokens.length - 1] || "";
  const options = [
    "--source",
    "--auth-dir",
    "--target-name",
    "--mode",
    "--base-url",
    "--model",
    "--force",
    "--dry-run",
    "--json",
  ];
  const modelItems = providerModelSelectors().map(value => ({ value, label: value }));
  if (tokens.includes("--model")) return modelItems.filter(item => item.value.startsWith(last));
  return options.filter(value => value.startsWith(last)).map(value => ({ value, label: value }));
}
