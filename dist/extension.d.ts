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
export default function clinePassExtension(pi: ExtensionHost): void;
export {};
