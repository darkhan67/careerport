// Small helpers shared by the API routes (Vercel Node.js functions).

export class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequest';
    this.status = 400;
    this.expose = true;
  }
}

function sendError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const message = err.expose ? err.message : 'Something went wrong on our side. Try again in a moment.';
  res.status(status).json({ error: message });
}

function readBody(req) {
  if (req.body == null || req.body === '') return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new BadRequest('The request body must be JSON.');
    }
  }
  return req.body;
}

/** Wraps a POST JSON route: parses the body, returns JSON, maps errors to status codes. */
export function postRoute(fn) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Use POST.' });
    }
    try {
      const result = await fn(readBody(req), req);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(result);
    } catch (err) {
      return sendError(res, err);
    }
  };
}

/* ---------- input validation ---------- */

export function text(value, { name, max = 300, required = false } = {}) {
  const v = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (required && !v) throw new BadRequest(`${name} is required.`);
  if (v.length > max) throw new BadRequest(`${name} is too long (max ${max} characters).`);
  return v;
}

export function number(value, { name, min, max, fallback }) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n)) {
    if (fallback !== undefined) return fallback;
    throw new BadRequest(`${name} must be a number.`);
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export const ENGLISH_LEVELS = ['basic', 'conversational', 'professional', 'fluent'];
export const WORK_AUTH = ['any_employer', 'need_sponsorship', 'not_sure'];

/** The career profile the user fills in. Free-text fields may be in any language. */
export function readProfile(p, { required = true } = {}) {
  if (!p || typeof p !== 'object') {
    if (required) throw new BadRequest('profile is required.');
    return null;
  }
  return {
    firstName: text(p.firstName, { name: 'First name', max: 60 }),
    profession: text(p.profession, { name: 'Profession', max: 200, required }),
    yearsExperience: number(p.yearsExperience, { name: 'Years of experience', min: 0, max: 45, fallback: 0 }),
    education: text(p.education, { name: 'Education', max: 300, required }),
    homeCountry: text(p.homeCountry, { name: 'Country', max: 80, required }),
    currentJob: text(p.currentJob, { name: 'Current job', max: 120 }),
    state: text(p.state, { name: 'US state', max: 40, required }),
    englishLevel: oneOf(p.englishLevel, ENGLISH_LEVELS, 'conversational'),
    hoursPerWeek: number(p.hoursPerWeek, { name: 'Hours per week', min: 1, max: 40, fallback: 5 }),
    workAuth: oneOf(p.workAuth, WORK_AUTH, 'not_sure'),
    language: text(p.language, { name: 'Language', max: 40 }) || 'English',
    goal: text(p.goal, { name: 'Anything else', max: 600 }),
  };
}

export function readTranscript(value) {
  if (!Array.isArray(value)) throw new BadRequest('transcript must be a list.');
  if (value.length > 14) throw new BadRequest('The interview is too long.');
  return value.map((turn, i) => {
    const from = turn?.from === 'candidate' ? 'candidate' : turn?.from === 'interviewer' ? 'interviewer' : null;
    if (!from) throw new BadRequest(`transcript[${i}] has an unknown speaker.`);
    return { from, text: text(turn.text, { name: 'Answer', max: 2500, required: true }) };
  });
}
