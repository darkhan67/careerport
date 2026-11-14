// POST /api/resume — writes a US-style resume for one target role.
import { postRoute, readProfile, text } from '../lib/http.js';
import { generateJson } from '../lib/llm.js';
import { resumePrompt } from '../lib/prompts.js';
import { normalizeResume } from '../lib/schema.js';

export default postRoute(async (body) => {
  const profile = readProfile(body.profile);
  const role = text(body.role, { name: 'Target role', max: 120, required: true });
  const c = body.contact || {};
  const contact = {
    name: text(c.name, { name: 'Name', max: 80 }),
    email: text(c.email, { name: 'Email', max: 120 }),
    phone: text(c.phone, { name: 'Phone', max: 40 }),
    city: text(c.city, { name: 'City', max: 80 }),
  };
  const experience = text(body.experience, { name: 'Experience notes', max: 6000 });
  const raw = await generateJson(resumePrompt({ profile, role, contact, experience }));
  return normalizeResume(raw);
});
