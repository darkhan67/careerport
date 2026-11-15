// Provider-agnostic access to a chat model that answers in JSON.
// Works with Google Gemini, OpenAI or Anthropic Claude: whichever API key is set.
// Uses plain fetch, so the project has zero runtime dependencies.

const DEFAULT_MODELS = {
  gemini: 'gemini-flash-latest',
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-5-5',
};

const KEY_NAMES = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export class LLMError extends Error {
  constructor(message, status = 502, { retryable = false } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.expose = true;
    this.retryable = retryable;
  }
}

export function resolveProvider(env = process.env) {
  const explicit = (env.LLM_PROVIDER || '').trim().toLowerCase();
  const name = explicit || Object.keys(KEY_NAMES).find((p) => env[KEY_NAMES[p]]);
  if (!name || !KEY_NAMES[name]) return null;
  const apiKey = env[KEY_NAMES[name]];
  if (!apiKey) return null;
  return { name, apiKey, model: env.LLM_MODEL || DEFAULT_MODELS[name] };
}

async function request(url, init, signal) {
  let res;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new LLMError('The AI took too long to answer. Try again.', 504);
    }
    throw new LLMError('Could not reach the AI service. Try again in a moment.', 502, { retryable: true });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error?.message || data?.error?.type || res.statusText;
    console.error(`[llm] ${res.status} from provider: ${detail}`);
    let error;
    if (res.status === 401 || res.status === 403) {
      error = new LLMError('The AI key was rejected. Check the API key in your environment settings.', 503);
    } else if (res.status === 429) {
      error = new LLMError('The AI service is busy right now. Wait a few seconds and try again.', 503, { retryable: true });
    } else {
      error = new LLMError('The AI service returned an error. Try again in a moment.', 502, {
        retryable: res.status >= 500,
      });
    }
    error.providerStatus = res.status;
    throw error;
  }
  return data;
}

const callers = {
  async gemini({ apiKey, model }, { system, user, fast }, signal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const data = await request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            // Short conversational turns don't need deep reasoning: answer faster.
            ...(fast ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
          },
        }),
      },
      signal,
    );
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  },

  async openai({ apiKey, model }, { system, user }, signal) {
    const data = await request(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      },
      signal,
    );
    return data?.choices?.[0]?.message?.content || '';
  },

  async anthropic({ apiKey, model }, { system, user }, signal) {
    const data = await request(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      },
      signal,
    );
    return (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  },
};

// Models sometimes wrap JSON in markdown fences or add a sentence around it.
export function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty response');
  const unfenced = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object found');
    return JSON.parse(unfenced.slice(start, end + 1));
  }
}

/**
 * Ask the configured model for a JSON object.
 * Retries once if the answer is not valid JSON, and once on a transient provider error.
 * `fast` asks for low reasoning effort where the provider supports it (used for live chat turns).
 */
export async function generateJson({ system, user, timeoutMs = 50_000, fast = false }) {
  const provider = resolveProvider();
  if (!provider) {
    throw new LLMError(
      'AI is not configured yet. Add GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY to the environment.',
      503,
    );
  }
  const call = callers[provider.name];
  let prompt = user;
  let providerRetries = 1;
  let fastMode = fast;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let text;
    try {
      text = await call(provider, { system, user: prompt, fast: fastMode }, AbortSignal.timeout(timeoutMs));
    } catch (err) {
      // A model that doesn't accept the low-reasoning setting answers 400: ask again without it.
      if (fastMode && err instanceof LLMError && err.providerStatus === 400) {
        fastMode = false;
        attempt -= 1;
        continue;
      }
      // Providers fail transiently now and then (busy, 5xx): retry once before giving up.
      if (err instanceof LLMError && err.retryable && providerRetries > 0) {
        providerRetries -= 1;
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      throw err;
    }
    try {
      return parseJson(text);
    } catch {
      prompt = `${user}\n\nYour previous answer was not valid JSON. Reply with one valid JSON object only.`;
    }
  }
  throw new LLMError('The AI answer could not be read. Try again.', 502);
}
