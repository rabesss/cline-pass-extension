import type { CommandResult, DoctorResult, Env, ParsedCommand, VerifyOptions, VerifyResult } from "./types.js";
export declare function doctorClinePass(env?: Env): Promise<DoctorResult>;
export declare function verifyClinePass(options?: VerifyOptions, env?: Env): Promise<VerifyResult>;
export declare function parseCommandArgs(args: string): ParsedCommand;
export declare function runClinePassCommand(args: string, env?: Env): Promise<CommandResult>;
export declare function commandUsage(): string;
export declare function formatCommandResult(result: CommandResult, json?: boolean): string;
