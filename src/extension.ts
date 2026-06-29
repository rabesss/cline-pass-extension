import {
  buildProviderConfig,
  CLINE_PASS_MODELS,
  commandUsage,
  formatCommandResult,
  runClinePassCommand,
} from "./core.js";

interface ExtensionHost {
  setLabel?: (label: string) => void;
  registerProvider: (id: string, provider: unknown) => void;
  registerCommand: (name: string, command: CommandDefinition) => void;
}

interface CommandContext {
  ui?: {
    notify?: (message: string, level?: "info" | "error") => void;
  };
}

interface CompletionItem {
  value: string;
  label: string;
}

interface CommandDefinition {
  description: string;
  getArgumentCompletions: (prefix: string) => CompletionItem[];
  handler: (args: string, ctx?: CommandContext) => Promise<void>;
}

export default function clinePassExtension(pi: ExtensionHost): void {
  if (typeof pi.setLabel === "function") pi.setLabel("Cline Pass");

  pi.registerProvider("cline-pass", buildProviderConfig());

  pi.registerCommand("clinepass", {
    description: "Inspect and verify the direct Cline Pass provider",
    getArgumentCompletions: argumentCompletions,
    handler: async (args, ctx) => {
      const wantsJson = /\s--json(?:[=\s]|$)/.test(` ${args}`);
      try {
        const result = await runClinePassCommand(args);
        emit(ctx, formatCommandResult(result, result?.json), result.ok ? "info" : "error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit(
          ctx,
          wantsJson ? JSON.stringify({ ok: false, command: "clinepass", message }, null, 2) : `FAIL clinepass: ${message}\n\n${commandUsage()}`,
          "error",
        );
      }
    },
  });
}

function emit(ctx: CommandContext | undefined, message: string, level: "info" | "error"): void {
  if (typeof ctx?.ui?.notify === "function") {
    ctx.ui.notify(message, level);
    return;
  }
  console.log(message);
}

function argumentCompletions(prefix: string): CompletionItem[] {
  const tokens = prefix.trimStart().split(/\s+/);
  const first = tokens[0] || "";
  if (!prefix.includes(" ")) {
    return ["doctor", "verify", "models", "help"]
      .filter(value => value.startsWith(first))
      .map(value => ({ value, label: value }));
  }

  const last = tokens[tokens.length - 1] || "";
  const previous = tokens[tokens.length - 2] || "";
  if (last === "--model" || previous === "--model") {
    const query = last === "--model" ? "" : last;
    return CLINE_PASS_MODELS.map(model => ({ value: model.id, label: model.name })).filter(item =>
      item.value.startsWith(query),
    );
  }
  return ["--model", "--base-url", "--json"].filter(value => value.startsWith(last)).map(value => ({ value, label: value }));
}
