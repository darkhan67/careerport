// Normalizes model output into the exact shapes the frontend expects,
// so a slightly off answer from the AI never breaks the page.
import { LLMError } from './llm.js';

const str = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const list = (v, max = 10) => (Array.isArray(v) ? v.slice(0, max) : []);
const strs = (v, max = 10, len = 300) => list(v, max).map((x) => str(x, len)).filter(Boolean);
const int = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const KINDS = ['bridge', 'target', 'stretch'];

export function normalizeAnalysis(raw) {
  const paths = list(raw?.paths, 3)
    .map((p, i) => ({
      title: str(p?.title, 120),
      kind: KINDS.includes(p?.kind) ? p.kind : KINDS[i] || 'target',
      fit: int(p?.fit, 0, 100, 60),
      timeToOffer: str(p?.timeToOffer, 60),
      cost: str(p?.cost, 60),
      salary: str(p?.salary, 80),
      license: {
        required: p?.license?.required === true || p?.license?.required === 'true',
        note: str(p?.license?.note, 500),
      },
      why: str(p?.why, 700),
      gaps: strs(p?.gaps, 5, 250),
      steps: strs(p?.steps, 6, 250),
    }))
    .filter((p) => p.title);
  if (!paths.length) throw new LLMError('The AI did not return any career paths. Try again.', 502);

  return {
    summary: str(raw?.summary, 700),
    strengths: strs(raw?.strengths, 5, 200),
    paths,
    credentials: str(raw?.credentials, 900),
    weeklyPlan: list(raw?.weeklyPlan, 7)
      .map((t) => ({ task: str(t?.task, 250), minutes: int(t?.minutes, 5, 600, 60) }))
      .filter((t) => t.task),
    interviewFocus: strs(raw?.interviewFocus, 5, 150),
  };
}

export function normalizeResume(raw) {
  const resume = {
    name: str(raw?.name, 80),
    headline: str(raw?.headline, 140),
    contact: str(raw?.contact, 200),
    summary: str(raw?.summary, 800),
    skills: strs(raw?.skills, 18, 60),
    experience: list(raw?.experience, 6)
      .map((e) => ({
        title: str(e?.title, 120),
        company: str(e?.company, 120),
        location: str(e?.location, 80),
        dates: str(e?.dates, 60),
        bullets: strs(e?.bullets, 6, 300),
      }))
      .filter((e) => e.title || e.company),
    education: list(raw?.education, 4)
      .map((e) => ({
        degree: str(e?.degree, 160),
        school: str(e?.school, 160),
        location: str(e?.location, 80),
        year: str(e?.year, 20),
        note: str(e?.note, 200),
      }))
      .filter((e) => e.degree || e.school),
    certifications: strs(raw?.certifications, 8, 160),
    notes: strs(raw?.notes, 5, 300),
  };
  if (!resume.summary && !resume.experience.length) {
    throw new LLMError('The AI returned an empty resume. Try again.', 502);
  }
  return resume;
}

export function normalizeTurn(raw) {
  const message = str(raw?.message, 700);
  if (!message) throw new LLMError('The interviewer did not answer. Try again.', 502);
  return message;
}

export function normalizeFeedback(raw, answerCount) {
  return {
    score: int(raw?.score, 0, 100, 50),
    verdict: str(raw?.verdict, 600),
    strengths: strs(raw?.strengths, 4, 300),
    improve: strs(raw?.improve, 4, 300),
    answers: list(raw?.answers, answerCount).map((a) => ({
      question: str(a?.question, 400),
      score: int(a?.score, 1, 10, 5),
      fixes: list(a?.fixes, 3)
        .map((f) => ({ said: str(f?.said, 200), better: str(f?.better, 300), why: str(f?.why, 300) }))
        .filter((f) => f.said && f.better),
      stronger: str(a?.stronger, 900),
      tip: str(a?.tip, 400),
    })),
    phrases: strs(raw?.phrases, 5, 160),
  };
}
