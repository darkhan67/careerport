// POST /api/interview — returns the interviewer's next line for a mock interview.
import { BadRequest, postRoute, readProfile, readTranscript, text } from '../lib/http.js';
import { generateJson } from '../lib/llm.js';
import { TOTAL_QUESTIONS, interviewPrompt } from '../lib/prompts.js';
import { normalizeTurn } from '../lib/schema.js';

export default postRoute(async (body) => {
  const role = text(body.role, { name: 'Role', max: 120, required: true });
  const profile = readProfile(body.profile, { required: false });
  const transcript = readTranscript(body.transcript ?? []);
  const jobPost = text(body.jobPost, { name: 'Job post', max: 8000 });

  if (transcript.length && transcript.at(-1).from !== 'candidate') {
    throw new BadRequest('Answer the current question first.');
  }

  const prompt = interviewPrompt({ role, profile, transcript, jobPost });
  const raw = await generateJson({ system: prompt.system, user: prompt.user, timeoutMs: 30_000, fast: true });
  return {
    message: normalizeTurn(raw),
    questionNumber: prompt.questionNumber,
    totalQuestions: TOTAL_QUESTIONS,
    done: prompt.finished,
  };
});
