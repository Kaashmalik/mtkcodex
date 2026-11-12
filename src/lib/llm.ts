/**
 * OpenAI-compatible chat completions, so any provider that serves open models
 * (DeepSeek, Kimi, GLM, Qwen…) works by changing env only.
 *
 *   LLM_BASE_URL       default https://api.river.ai/v1 (River); any OpenAI-compatible base works
 *   LLM_API_KEY        provider key (River keys start with rv_)
 *   LLM_MODEL_FAST     scoring many jobs cheaply (default deepseek-ai/DeepSeek-V4.1-Flash)
 *   LLM_MODEL_WRITER   writing proposals (default moonshotai/Kimi-K3.1-Pro)
 *   LLM_REASONING      reasoning_effort for the writer: none | low | high | max (default low;
 *                      Kimi defaults to max, which is slow and costly for a short email)
 */

const env = (key: string) => (process.env[key] || '').trim();

const DEFAULT_BASE_URL = 'https://api.river.ai/v1';

export function llmConfigured(): boolean {
  return Boolean(env('LLM_API_KEY'));
}

export function llmModels() {
  return {
    fast: env('LLM_MODEL_FAST') || 'deepseek-ai/DeepSeek-V4.1-Flash',
    writer: env('LLM_MODEL_WRITER') || 'moonshotai/Kimi-K3.1-Pro',
    writerReasoning: env('LLM_REASONING') || 'low',
  };
}

export type ChatInput = {
  model: string;
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Sent as reasoning_effort; dropped automatically if the model rejects it. */
  reasoning?: string;
};

export type ChatResult = { text: string; model: string; usage: { input: number; output: number } };

export async function chat(input: ChatInput): Promise<ChatResult> {
  if (!llmConfigured()) throw new Error('AI is not configured. Add LLM_API_KEY (and LLM_BASE_URL if not using River).');
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
    max_tokens: input.maxTokens ?? 1200,
    temperature: input.temperature ?? 0.4,
  };
  if (input.json) body.response_format = { type: 'json_object' };
  if (input.reasoning) body.reasoning_effort = input.reasoning;

  const url = `${(env('LLM_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
  const send = (payload: Record<string, unknown>) =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env('LLM_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(input.timeoutMs ?? 25_000),
      cache: 'no-store',
    });

  let res = await send(body);
  // Some models reject response_format or reasoning_effort; the prompt already asks for JSON, so retry without them.
  if (res.status === 400 && (input.json || input.reasoning)) {
    const { response_format: _format, reasoning_effort: _effort, ...rest } = body;
    void _format;
    void _effort;
    res = await send(rest);
  }
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
    error?: { message?: string } | string;
  };
  if (!res.ok) {
    const message = typeof data.error === 'string' ? data.error : data.error?.message;
    throw new Error(`AI ${res.status}: ${(message || 'request failed').slice(0, 300)}`);
  }
  const text = data.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('AI returned an empty answer.');
  return {
    text,
    model: data.model || input.model,
    usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
  };
}

/**
 * Pulls the JSON out of a model answer: drops <think> blocks (reasoning
 * models), code fences and any prose around the first object or array.
 */
export function parseJsonLoose<T = unknown>(text: string): T {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through to the bracket scan
  }
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new Error('AI answer had no JSON.');
  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const c = cleaned[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth += 1;
    else if (c === close && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T;
  }
  throw new Error('AI answer had incomplete JSON.');
}
