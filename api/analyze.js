// POST /api/analyze — maps a foreign career to three US paths and a weekly plan.
import { postRoute, readProfile } from '../lib/http.js';
import { generateJson } from '../lib/llm.js';
import { analyzePrompt } from '../lib/prompts.js';
import { normalizeAnalysis } from '../lib/schema.js';

export default postRoute(async (body) => {
  const profile = readProfile(body.profile);
  const raw = await generateJson(analyzePrompt(profile));
  return normalizeAnalysis(raw);
});
