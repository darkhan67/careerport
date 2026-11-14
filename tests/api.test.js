// API tests. The AI provider is replaced by a stubbed fetch, so they run offline.
// Run: npm test
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

const realFetch = globalThis.fetch;
const ENV_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL'];
let calls = [];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.GEMINI_API_KEY = 'test-key';
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Makes the "AI" answer with the given payloads, one per call. */
function stubAI(...payloads) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    const next = payloads.length > 1 ? payloads.shift() : payloads[0];
    if (next instanceof Response) return next;
    const text = typeof next === 'string' ? next : JSON.stringify(next);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

async function call(route, body, method = 'POST') {
  const { default: handler } = await import(`../api/${route}.js`);
  const res = mockRes();
  await handler({ method, body }, res);
  return res;
}

const profile = {
  firstName: 'Darkhan',
  profession: 'Инженер-строитель, мосты',
  yearsExperience: 9,
  education: 'Master of Civil Engineering, 2014',
  homeCountry: 'Kazakhstan',
  currentJob: 'Delivery driver',
  state: 'Texas',
  englishLevel: 'conversational',
  hoursPerWeek: 5,
  workAuth: 'any_employer',
  language: 'Russian',
};

const analysis = {
  summary: 'Ваш опыт востребован.',
  strengths: ['Bridge design', 'AutoCAD'],
  paths: [
    { title: 'Civil Engineering Technician', kind: 'bridge', fit: 140, timeToOffer: '2–4 months', cost: '$0–$200', salary: '$55k–$70k/yr', license: { required: false, note: 'Не нужна' }, why: 'Тот же навык', gaps: ['US codes'], steps: ['Резюме'] },
    { title: 'Civil Engineer (EIT)', kind: 'target', fit: 80, license: { required: true, note: 'FE exam' } },
    { title: 'Project Engineer', kind: 'weird-kind', fit: 'n/a' },
    { title: 'Extra path that should be dropped', kind: 'stretch' },
  ],
  credentials: 'Course-by-course evaluation',
  weeklyPlan: [{ task: 'Order WES evaluation', minutes: 45 }, { task: '', minutes: 10 }],
  interviewFocus: ['Tell me about yourself'],
};

describe('POST /api/analyze', () => {
  test('rejects a profile without a profession', async () => {
    stubAI(analysis);
    const res = await call('analyze', { profile: { ...profile, profession: '' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Profession is required/);
    assert.equal(calls.length, 0, 'the AI must not be called for invalid input');
  });

  test('sends the profile to the model and normalizes the answer', async () => {
    stubAI(analysis);
    const res = await call('analyze', { profile });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paths.length, 3, 'keeps at most three paths');
    assert.equal(res.body.paths[0].fit, 100, 'clamps fit to 0–100');
    assert.equal(res.body.paths[1].license.required, true);
    assert.equal(res.body.paths[2].kind, 'stretch', 'unknown kinds fall back by position');
    assert.equal(res.body.weeklyPlan.length, 1, 'drops empty tasks');

    const sent = calls[0].body;
    assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
    assert.match(sent.contents[0].parts[0].text, /Инженер-строитель/);
    assert.match(sent.systemInstruction.parts[0].text, /in Russian/);
  });

  test('accepts JSON wrapped in markdown fences', async () => {
    stubAI('```json\n' + JSON.stringify(analysis) + '\n```');
    const res = await call('analyze', { profile });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paths[0].title, 'Civil Engineering Technician');
  });

  test('retries once when the model answers with broken JSON', async () => {
    stubAI('not json at all', analysis);
    const res = await call('analyze', { profile });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 2);
  });

  test('explains a rejected API key instead of failing silently', async () => {
    stubAI(new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }));
    const res = await call('analyze', { profile });
    assert.equal(res.statusCode, 502);
    assert.ok(res.body.error.length > 10);
  });

  test('says clearly when no AI key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await call('analyze', { profile });
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /GEMINI_API_KEY/);
  });

  test('only accepts POST', async () => {
    const res = await call('analyze', {}, 'GET');
    assert.equal(res.statusCode, 405);
  });
});

describe('POST /api/interview', () => {
  test('opens the interview with question 1', async () => {
    stubAI({ message: "Hi Darkhan, I'm Sarah. Tell me about yourself." });
    const res = await call('interview', { role: 'Civil Engineering Technician', profile, transcript: [] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.questionNumber, 1);
    assert.equal(res.body.done, false);
  });

  test('finishes after the fifth answer', async () => {
    stubAI({ message: 'Thank you, your feedback is ready.' });
    const transcript = [];
    for (let i = 1; i <= 5; i += 1) {
      transcript.push({ from: 'interviewer', text: `Question ${i}?` }, { from: 'candidate', text: `Answer ${i}` });
    }
    const res = await call('interview', { role: 'Civil Engineering Technician', profile, transcript });
    assert.equal(res.body.done, true);
    assert.match(calls[0].body.contents[0].parts[0].text, /Do not ask anything else/);
  });

  test('refuses to move on before the candidate answers', async () => {
    stubAI({ message: 'Next question?' });
    const res = await call('interview', {
      role: 'Staff Accountant',
      transcript: [{ from: 'interviewer', text: 'Tell me about yourself.' }],
    });
    assert.equal(res.statusCode, 400);
  });
});

describe('POST /api/feedback', () => {
  test('needs at least one answer', async () => {
    stubAI({});
    const res = await call('feedback', { role: 'Staff Accountant', transcript: [{ from: 'interviewer', text: 'Hi?' }] });
    assert.equal(res.statusCode, 400);
  });

  test('returns one review per answer and drops incomplete fixes', async () => {
    stubAI({
      score: 72,
      verdict: 'Good start.',
      answers: [
        { question: 'Tell me about yourself.', score: 7, fixes: [{ said: 'I am work', better: 'I work', why: 'Grammar' }, { said: '', better: 'x' }], stronger: 'I am a civil engineer...', tip: 'Add numbers.' },
        { question: 'Extra', score: 3 },
      ],
      phrases: ['I led a team of [X] engineers.'],
    });
    const res = await call('feedback', {
      role: 'Civil Engineering Technician',
      profile,
      transcript: [
        { from: 'interviewer', text: 'Tell me about yourself.' },
        { from: 'candidate', text: 'I am work as engineer nine years.' },
      ],
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.score, 72);
    assert.equal(res.body.answers.length, 1);
    assert.equal(res.body.answers[0].fixes.length, 1);
  });
});

describe('provider selection', () => {
  test('uses the explicitly chosen provider', async () => {
    const { resolveProvider } = await import('../lib/llm.js');
    const p = resolveProvider({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk', GEMINI_API_KEY: 'g' });
    assert.equal(p.name, 'openai');
  });

  test('falls back to whichever key exists', async () => {
    const { resolveProvider } = await import('../lib/llm.js');
    assert.equal(resolveProvider({ ANTHROPIC_API_KEY: 'a' }).name, 'anthropic');
    assert.equal(resolveProvider({}), null);
  });
});

describe('GET /api/config', () => {
  test('reports whether AI is configured without leaking keys', async () => {
    const res = await call('config', undefined, 'GET');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.aiConfigured, true);
    assert.ok(!JSON.stringify(res.body).includes('test-key'));
  });
});
