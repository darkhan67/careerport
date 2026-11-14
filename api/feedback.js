// POST /api/feedback — scores a finished mock interview and fixes the candidate's English.
import { BadRequest, postRoute, readProfile, readTranscript, text } from '../lib/http.js';
import { generateJson } from '../lib/llm.js';
import { feedbackPrompt } from '../lib/prompts.js';
import { normalizeFeedback } from '../lib/schema.js';

export default postRoute(async (body) => {
  const role = text(body.role, { name: 'Role', max: 120, required: true });
  const profile = readProfile(body.profile, { required: false });
  const transcript = readTranscript(body.transcript ?? []);
  const answerCount = transcript.filter((t) => t.from === 'candidate').length;
  if (!answerCount) throw new BadRequest('Answer at least one question to get feedback.');

  const raw = await generateJson(feedbackPrompt({ role, profile, transcript }));
  return normalizeFeedback(raw, answerCount);
});
