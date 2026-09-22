function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Extracts the provider's error text from a non-2xx body without leaking headers. */
async function errorMessage(response) {
    const text = (await response.text()).slice(0, 500);
    return text === '' ? response.statusText : text;
}
/** Flattens Node fetch's wrapped cause (DNS, connect timeout, reset, TLS). */
function transportCause(error) {
    const parts = [];
    let current = error;
    for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
        parts.push(current.message);
        current = current.cause;
    }
    if (typeof current === 'string' && current !== '')
        parts.push(current);
    return [...new Set(parts)].join(' | ');
}
const TRANSPORT_DELAYS_MS = [500, 2_000, 5_000];
/**
 * A provider that accepts the connection and then never answers would otherwise
 * hang the stage forever: Node's fetch has no response timeout of its own.
 */
const DEFAULT_TIMEOUT_MS = 300_000;
function requestTimeoutMs() {
    const raw = Number(process.env.AI_DEV_TEAM_REQUEST_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}
function isTimeout(error) {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
/**
 * POSTs JSON with a small transport-level retry: transient network failures
 * (Wi-Fi drop, provider restart, kept-alive socket closed) should not cost a
 * whole stage retry, which would resend the entire conversation. Only thrown
 * fetch errors retry; HTTP error statuses are returned to the caller.
 */
export async function postJson(options) {
    const delays = options.delaysMs ?? TRANSPORT_DELAYS_MS;
    const timeoutMs = options.timeoutMs ?? requestTimeoutMs();
    let lastError;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        if (attempt > 0)
            await new Promise((resolve) => setTimeout(resolve, delays[attempt - 1] ?? 0));
        try {
            return await options.fetchImpl(options.url, {
                method: 'POST',
                headers: options.headers,
                body: options.body,
                signal: AbortSignal.timeout(timeoutMs),
            });
        }
        catch (error) {
            // A timeout already spent the whole budget; retrying in-place would only
            // stall the stage further, so it surfaces to the stage-level retry.
            if (isTimeout(error))
                throw new Error(`Provider did not respond within ${timeoutMs}ms. Set AI_DEV_TEAM_REQUEST_TIMEOUT_MS to change the budget.`, { cause: error });
            lastError = error;
        }
    }
    throw new Error(`Network error: fetch failed (${transportCause(lastError)})`, {
        cause: lastError,
    });
}
function parseToolCalls(message) {
    const raw = message.tool_calls;
    if (!Array.isArray(raw))
        return [];
    const calls = [];
    for (const [index, entry] of raw.entries()) {
        if (!isRecord(entry) || !isRecord(entry.function))
            continue;
        const name = entry.function.name;
        if (typeof name !== 'string' || name === '')
            continue;
        const args = entry.function.arguments;
        calls.push({
            id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `call_${index}`,
            name,
            argumentsJson: typeof args === 'string' ? args : JSON.stringify(args === undefined ? {} : args),
        });
    }
    return calls;
}
/**
 * One round-trip against an OpenAI-compatible Chat Completions endpoint.
 * The baseUrl already contains the API version segment (e.g. /v1), so only
 * the endpoint suffix is appended — see the convention note in catalog.ts.
 */
export async function callOpenAiChat(options) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const body = {
        model: options.model,
        messages: options.messages,
    };
    if (options.tools && options.tools.length > 0) {
        body.tools = options.tools;
        body.tool_choice = 'auto';
    }
    const response = await postJson({
        fetchImpl,
        url: `${options.baseUrl}/chat/completions`,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        ...(options.transportDelaysMs === undefined ? {} : { delaysMs: options.transportDelaysMs }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
    if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${await errorMessage(response)}`);
    const payload = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.choices))
        throw new Error('OpenAI-compatible provider returned an unexpected payload.');
    const first = payload.choices[0];
    if (!isRecord(first) || !isRecord(first.message))
        throw new Error('OpenAI-compatible provider returned no choices.');
    const message = first.message;
    const text = typeof message.content === 'string' ? message.content : '';
    return {
        reply: { text, toolCalls: parseToolCalls(message) },
        assistantMessage: message,
    };
}
