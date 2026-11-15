// POST /api/match — compares the user with one job post and tailors the application to it.
import { BadRequest, postRoute, readProfile, text } from '../lib/http.js';
import { generateJson } from '../lib/llm.js';
import { matchPrompt } from '../lib/prompts.js';
import { normalizeMatch } from '../lib/schema.js';

export default postRoute(async (body) => {
  const profile = readProfile(body.profile);
  const jobPost = text(body.jobPost, { name: 'Job post', max: 8000, required: true });
  if (jobPost.length < 80) throw new BadRequest('Paste the whole job post, not just the title.');
  const resumeText = text(body.resumeText, { name: 'Resume', max: 6000 });
  const raw = await generateJson(matchPrompt({ profile, jobPost, resumeText }));
  return normalizeMatch(raw);
});
