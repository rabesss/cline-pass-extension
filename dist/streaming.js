import { CLINE_API_BASE, DEFAULT_MODEL, PROVIDER_ID } from "./constants.js";
import { missingApiKeyMessage, resolveRuntimeApiKey } from "./auth.js";
import { resolveReasoningEffort, toWireModelId } from "./models.js";
import { clineHTTPErrorMessage, nonSseStreamError, unwrapClineResponsePayload } from "./responses.js";
import { normalizeBaseUrl, numberValue, stringValue } from "./utils.js";
class ClinePassEventStream {
    queue = [];
    waiting = [];
    done = false;
    push(event) {
        if (this.done)
            return;
        if (event.type === "done" || event.type === "error")
            this.done = true;
        const waiter = this.waiting.shift();
        if (waiter)
            waiter.resolve({ value: event, done: false });
        else
            this.queue.push(event);
    }
    end() {
        this.done = true;
        while (this.waiting.length > 0)
            this.waiting.shift()?.resolve({ value: undefined, done: true });
    }
    async *[Symbol.asyncIterator]() {
        while (true) {
            const next = this.queue.shift();
            if (next) {
                yield next;
            }
            else if (this.done) {
                return;
            }
            else {
                const event = await new Promise(resolve => this.waiting.push({ resolve }));
                if (event.done)
                    return;
                yield event.value;
            }
        }
    }
}
export function createStreamClinePass(deps = {}) {
    const apiBase = deps.baseUrl || deps.apiBase || process.env.CLINE_PASS_API_BASE || CLINE_API_BASE;
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const createStream = deps.createStream || (() => new ClinePassEventStream());
    const now = deps.now || (() => Date.now());
    return function streamClinePass(model = {}, context = {}, options = {}) {
        const stream = createStream();
        async function run() {
            const output = {
                role: "assistant",
                content: [],
                api: model?.api,
                provider: model?.provider || PROVIDER_ID,
                model: model?.id || DEFAULT_MODEL,
                usage: defaultUsage(),
                stopReason: "stop",
                timestamp: now(),
            };
            try {
                if (typeof fetchImpl !== "function") {
                    throw new Error("global fetch is not available; use Node 18+ or a runtime with fetch");
                }
                const apiKey = await resolveRuntimeApiKey({ ...options, baseUrl: apiBase, fetchImpl });
                if (!apiKey) {
                    throw new Error(missingApiKeyMessage());
                }
                stream.push({ type: "start", partial: output });
                const payload = {
                    model: toWireModelId(model?.id || DEFAULT_MODEL),
                    messages: messagesToOpenAI(context),
                    stream: true,
                    max_tokens: Math.min(options.maxTokens || model?.maxTokens || 16384, model?.maxTokens || 16384),
                };
                const reasoningEffort = resolveReasoningEffort(model, options);
                if (reasoningEffort)
                    payload.reasoning_effort = reasoningEffort;
                const tools = toolsToOpenAI(context?.tools);
                if (tools.length > 0)
                    payload.tools = tools;
                if (options.toolChoice)
                    payload.tool_choice = options.toolChoice;
                if (typeof options.onPayload === "function")
                    await options.onPayload(payload, model);
                const init = {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                };
                if (options.signal)
                    init.signal = options.signal;
                const response = await fetchImpl(`${normalizeBaseUrl(apiBase)}/chat/completions`, init);
                if (typeof options.onResponse === "function") {
                    await options.onResponse({ status: response.status, headers: headersToRecord(response.headers) }, model);
                }
                if (!response.ok) {
                    const data = await response.json().catch(() => undefined);
                    throw new Error(clineHTTPErrorMessage(response.status, data));
                }
                const result = response.body && isEventStream(response.headers)
                    ? await consumeOpenAIStream(response.body, output, stream, model)
                    : await consumeOpenAINonStreamingFallback(response, output, stream, model);
                output.stopReason = result.toolUse ? "toolUse" : finishReason(result.finishReason);
                stream.push({ type: "done", reason: output.stopReason, message: output });
            }
            catch (error) {
                output.stopReason = error instanceof Error && error.name === "AbortError" ? "aborted" : "error";
                output.errorMessage = error instanceof Error ? error.message : String(error);
                stream.push({ type: "error", reason: output.stopReason === "aborted" ? "aborted" : "error", error: output });
            }
            finally {
                stream.end();
            }
        }
        queueMicrotask(run);
        return stream;
    };
}
async function consumeOpenAIStream(body, output, stream, model) {
    let textBlock;
    let textIndex = -1;
    let thinkingBlock;
    let thinkingIndex = -1;
    let finishReason;
    const toolCalls = new Map();
    function endThinkingBlock() {
        if (!thinkingBlock)
            return;
        stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: stringValue(thinkingBlock.thinking), partial: output });
        thinkingBlock = undefined;
        thinkingIndex = -1;
    }
    for await (const payload of readOpenAISsePayloads(body)) {
        if (payload === "[DONE]")
            break;
        let chunk;
        try {
            chunk = parseOpenAIStreamPayload(payload);
        }
        catch (error) {
            if (!(error instanceof SyntaxError))
                throw error instanceof Error ? error : new Error(String(error));
            throw new Error("Cline API returned an invalid streaming JSON chunk.");
        }
        const choice = chunk.choices?.[0] || {};
        if (choice.finish_reason)
            finishReason = choice.finish_reason;
        if (chunk.usage && (choice.finish_reason || (Array.isArray(chunk.choices) && chunk.choices.length === 0))) {
            applyUsage(output.usage, chunk.usage, model);
        }
        const delta = choice.delta || {};
        const reasoning = stringValue(delta.reasoning) || stringValue(delta.reasoning_content);
        if (reasoning) {
            if (!thinkingBlock) {
                thinkingBlock = { type: "thinking", thinking: "" };
                thinkingIndex = output.content.length;
                output.content.push(thinkingBlock);
                stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
            }
            thinkingBlock.thinking = `${stringValue(thinkingBlock.thinking)}${reasoning}`;
            stream.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: reasoning, partial: output });
        }
        const content = stringValue(delta.content);
        if (content) {
            endThinkingBlock();
            if (!textBlock) {
                textBlock = { type: "text", text: "" };
                textIndex = output.content.length;
                output.content.push(textBlock);
                stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
            }
            textBlock.text = `${stringValue(textBlock.text)}${content}`;
            stream.push({ type: "text_delta", contentIndex: textIndex, delta: content, partial: output });
        }
        const deltaToolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
        if (deltaToolCalls.length > 0)
            endThinkingBlock();
        for (const tool of deltaToolCalls) {
            const index = typeof tool.index === "number" ? tool.index : toolCalls.size;
            const pending = toolCalls.get(index) || { id: "", name: "", arguments: "" };
            const id = stringValue(tool.id);
            const name = stringValue(tool.function?.name);
            if (id)
                pending.id = id;
            if (name)
                pending.name = name;
            if (typeof tool.function?.arguments === "string")
                pending.arguments += tool.function.arguments;
            toolCalls.set(index, pending);
        }
    }
    endThinkingBlock();
    if (textBlock) {
        stream.push({ type: "text_end", contentIndex: textIndex, content: stringValue(textBlock.text), partial: output });
    }
    const shouldEmitToolCalls = allowsToolCalls(finishReason);
    if (shouldEmitToolCalls)
        emitPendingToolCalls(toolCalls, output, stream);
    return { finishReason, toolUse: shouldEmitToolCalls && toolCalls.size > 0 };
}
function parseOpenAIStreamPayload(payload) {
    const chunk = JSON.parse(payload);
    if (typeof chunk.success !== "boolean")
        return chunk;
    return unwrapClineResponsePayload(chunk);
}
async function consumeOpenAINonStreamingFallback(response, output, stream, model) {
    const rawData = await response.json().catch(() => undefined);
    if (!rawData)
        throw new Error("Cline API returned a streaming response without a readable body.");
    const data = unwrapClineResponsePayload(rawData);
    applyUsage(output.usage, data?.usage, model);
    const message = data?.choices?.[0]?.message || {};
    const reasoning = stringValue(message.reasoning) || stringValue(message.reasoning_content);
    if (reasoning) {
        const thinkingBlock = { type: "thinking", thinking: reasoning };
        const index = output.content.length;
        output.content.push(thinkingBlock);
        stream.push({ type: "thinking_start", contentIndex: index, partial: output });
        stream.push({ type: "thinking_delta", contentIndex: index, delta: reasoning, partial: output });
        stream.push({ type: "thinking_end", contentIndex: index, content: reasoning, partial: output });
    }
    const content = stringValue(message.content);
    if (content) {
        const textBlock = { type: "text", text: content };
        const index = output.content.length;
        output.content.push(textBlock);
        stream.push({ type: "text_start", contentIndex: index, partial: output });
        stream.push({ type: "text_delta", contentIndex: index, delta: content, partial: output });
        stream.push({ type: "text_end", contentIndex: index, content, partial: output });
    }
    const toolCalls = new Map();
    const messageToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const [index, tool] of messageToolCalls.entries()) {
        toolCalls.set(index, {
            id: stringValue(tool.id) || `tool_${output.content.length + index}`,
            name: stringValue(tool.function?.name),
            arguments: stringValue(tool.function?.arguments),
        });
    }
    const finishReason = data?.choices?.[0]?.finish_reason;
    const shouldEmitToolCalls = allowsToolCalls(finishReason);
    if (shouldEmitToolCalls)
        emitPendingToolCalls(toolCalls, output, stream);
    return { finishReason, toolUse: shouldEmitToolCalls && toolCalls.size > 0 };
}
function emitPendingToolCalls(pendingToolCalls, output, stream) {
    for (const [, pending] of [...pendingToolCalls.entries()].sort(([left], [right]) => left - right)) {
        if (!pending.name)
            throw new Error("Cline API returned a tool call without a function name.");
        const toolCall = {
            type: "toolCall",
            id: pending.id || `tool_${output.content.length}`,
            name: pending.name,
            arguments: parseToolArguments(pending.arguments),
        };
        const index = output.content.length;
        output.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: index, partial: output });
        stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: output });
    }
}
async function* readOpenAISsePayloads(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawPayload = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const parsed = consumeSseLines(buffer);
            buffer = parsed.rest;
            if (parsed.payloads.length > 0)
                sawPayload = true;
            yield* parsed.payloads;
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
            const parsed = consumeSseLines(`${buffer}\n`, true);
            if (parsed.payloads.length > 0) {
                sawPayload = true;
                yield* parsed.payloads;
            }
            else if (!sawPayload) {
                throw nonSseStreamError(buffer);
            }
        }
        if (!sawPayload)
            throw nonSseStreamError(buffer);
    }
    finally {
        reader.releaseLock();
    }
}
function consumeSseLines(buffer, flush = false) {
    const lines = buffer.split(/\r?\n/);
    const rest = flush ? "" : lines.pop() || "";
    const payloads = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:"))
            continue;
        const payload = trimmed.slice(5).trim();
        if (payload)
            payloads.push(payload);
    }
    return { payloads, rest };
}
function messagesToOpenAI(context = {}) {
    const messages = [];
    const knownToolCallIds = new Set();
    const systemPrompt = Array.isArray(context.systemPrompt) ? context.systemPrompt.join("\n\n") : stringValue(context.systemPrompt);
    if (systemPrompt)
        messages.push({ role: "system", content: systemPrompt });
    for (const message of context.messages || []) {
        const role = ["system", "user", "assistant", "tool"].includes(stringValue(message.role)) ? stringValue(message.role) : "user";
        if (role === "assistant") {
            const assistant = { role, content: textFromContent(message.content) };
            const toolCalls = assistantToolCalls(message.content);
            const validToolCalls = toolCalls.filter(toolCall => stringValue(toolCall.id));
            for (const toolCall of validToolCalls)
                knownToolCallIds.add(stringValue(toolCall.id));
            if (validToolCalls.length > 0)
                assistant.tool_calls = validToolCalls;
            messages.push(assistant);
        }
        else if (role === "tool") {
            const toolCallId = stringValue(message.toolCallId);
            if (!toolCallId)
                throw new Error("Tool messages must include a non-empty toolCallId.");
            if (!knownToolCallIds.has(toolCallId)) {
                throw new Error(`Tool message references unknown toolCallId: ${toolCallId}`);
            }
            messages.push({
                role,
                tool_call_id: toolCallId,
                content: textFromContent(message.content),
            });
        }
        else {
            messages.push({ role, content: textFromContent(message.content) });
        }
    }
    if (messages.length === 0)
        messages.push({ role: "user", content: "" });
    return messages;
}
function textFromContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return content == null ? "" : String(content);
    return content.map(part => {
        if (typeof part === "string")
            return part;
        if (part?.type === "text")
            return stringValue(part.text);
        if (part?.type === "thinking")
            return stringValue(part.thinking);
        return "";
    }).filter(Boolean).join("\n");
}
function assistantToolCalls(content) {
    if (!Array.isArray(content))
        return [];
    return content
        .filter(part => part?.type === "toolCall")
        .map(part => ({
        id: stringValue(part.id),
        type: "function",
        function: {
            name: stringValue(part.name),
            arguments: JSON.stringify(part.arguments || {}),
        },
    }));
}
function toolsToOpenAI(tools = []) {
    if (!Array.isArray(tools))
        return [];
    return tools.map(tool => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description || "",
            parameters: tool.parameters || {},
        },
    }));
}
function headersToRecord(headers) {
    const out = {};
    if (!headers || typeof headers.forEach !== "function")
        return out;
    headers.forEach((value, key) => {
        out[key] = value;
    });
    return out;
}
function isEventStream(headers) {
    let contentType = "";
    headers?.forEach?.((value, key) => {
        if (key.toLowerCase() === "content-type")
            contentType = value;
    });
    return contentType.toLowerCase().includes("text/event-stream");
}
function parseToolArguments(input) {
    if (input == null || input === "")
        return {};
    if (typeof input === "object" && !Array.isArray(input))
        return input;
    try {
        const parsed = JSON.parse(String(input));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            return parsed;
    }
    catch {
    }
    throw new Error("Cline API returned invalid tool call arguments.");
}
function applyUsage(usage, source, model = {}) {
    usage.input = numberValue(source?.prompt_tokens);
    usage.output = numberValue(source?.completion_tokens);
    const reasoningTokens = source?.completion_tokens_details?.reasoning_tokens;
    if (typeof reasoningTokens === "number" && Number.isFinite(reasoningTokens))
        usage.reasoning = reasoningTokens;
    usage.totalTokens = numberValue(source?.total_tokens) || usage.input + usage.output;
    if (!model?.cost)
        return;
    usage.cost.input = (model.cost.input / 1_000_000) * usage.input;
    usage.cost.output = (model.cost.output / 1_000_000) * usage.output;
    usage.cost.total = usage.cost.input + usage.cost.output;
}
function defaultUsage() {
    return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
}
function finishReason(reason) {
    const value = stringValue(reason);
    if (!value || value === "stop")
        return "stop";
    if (value === "length")
        return "length";
    if (value === "tool_calls" || value === "function_call")
        return "toolUse";
    if (value === "content_filter")
        return "contentFilter";
    return value;
}
function allowsToolCalls(reason) {
    const value = stringValue(reason);
    return !value || value === "stop" || value === "tool_calls" || value === "function_call";
}
//# sourceMappingURL=streaming.js.map