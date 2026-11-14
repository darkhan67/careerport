# CareerPort

**Get back to the work you trained for.**

CareerPort helps immigrant professionals in the US who work below their skill level (the engineer driving for a delivery app, the accountant at a cash register) find their way back into their field. In about 15 minutes it gives them:

1. **Three US career paths** matched to their foreign experience: a fast start, their real profession and a higher ceiling. Each path comes with starting pay, time to a first offer, upfront cost and license rules.
2. **A plan for this week** that fits the hours they actually have after a shift, with a checklist they come back to.
3. **A US-style resume** for the chosen role: one page, results first, foreign titles translated, and placeholders instead of invented numbers.
4. **A spoken mock interview** with an AI hiring manager (five questions, answered by voice or typing), followed by a score, corrected English, stronger model answers and phrases to learn.

Users can write in their own language and read the explanations in 13 languages. Everything that goes to an employer (resume, interview) stays in English.

## Who it's for

Adults aged 25–45 who already live and work in the US, came with a degree and experience, and are stuck in a "survival job". About 2 million college-educated immigrants in the US work in low-skilled jobs or can't find work (Migration Policy Institute, *Untapped Talent*, 2016).

## Business model

B2C freemium.

| | Free | Pro, $19/month |
|---|---|---|
| Career paths and weekly plan | ✓ | ✓, refreshed every Monday |
| US resume | 1 | One for every path and job post |
| Mock interviews | 2 per week | Unlimited |
| Progress tracking | ✓ | ✓ |

A single offer in their field raises a user's pay by tens of thousands of dollars a year, so the subscription pays for itself many times over. During the competition the weekly interview limit is soft (the upgrade screen can be dismissed) so the jury can test everything. Set `STRIPE_PAYMENT_LINK` to send the Pro button to a Stripe Payment Link.

## How it works

```
public/            Static frontend (vanilla HTML/CSS/JS, no build step)
  index.html       Landing page
  app.html         The app: profile, paths, resume, interview, progress
  js/app.js        App logic and rendering (safe DOM building, no innerHTML)
  js/voice.js      Browser speech recognition and text-to-speech
  js/store.js      Local storage: the user's data stays in their browser
api/               Vercel serverless functions (Node.js)
  analyze.js       POST: profile → 3 paths, weekly plan, credential advice
  resume.js        POST: profile + notes → structured US resume
  interview.js     POST: transcript → the interviewer's next line
  feedback.js      POST: transcript → score, fixes, stronger answers
  config.js        GET: public settings (is AI configured, payment link)
lib/
  llm.js           Provider-agnostic AI client: Gemini, OpenAI or Claude, JSON output, retry
  prompts.js       All prompts in one place
  schema.js        Normalizes AI output so the UI never breaks on a bad answer
  http.js          Input validation and error handling for the routes
tests/             Node test runner, AI stubbed (runs offline)
```

- **No dependencies.** The backend uses the built-in `fetch`; the frontend is plain ES modules. Nothing to install, nothing to break at build time.
- **No accounts.** Profiles, plans, resumes and interview history live in `localStorage`. The server is stateless and stores nothing.
- **Voice is free and private.** Speech recognition and speech synthesis run in the browser (Chrome, Edge, Safari). Typing works everywhere.
- **Honest AI.** Prompts forbid invented numbers and employers (the resume uses `[X]` placeholders), require naming state licenses when a job needs one, and label pay and timing as estimates with a link to official O*NET data.
- **Safe rendering.** AI text is always inserted with `textContent`, never as HTML.

## Run it locally

Requires Node.js 20 or newer.

```bash
cp .env.example .env     # then put your key into .env
node dev-server.js       # http://localhost:3000
npm test                 # API tests, no key or network needed
```

Get a free Gemini key at [aistudio.google.com](https://aistudio.google.com/). `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` work too.

## Deploy to Vercel

1. Import this repository in Vercel. Framework preset: **Other**. No build command.
2. Add the environment variable `GEMINI_API_KEY` (or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`).
3. Deploy. Open `/api/config`: it should show `"aiConfigured": true`.

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | one of them | AI provider key |
| `LLM_PROVIDER` | no | Force `gemini`, `openai` or `anthropic` |
| `LLM_MODEL` | no | Override the default model |
| `STRIPE_PAYMENT_LINK` | no | Stripe Payment Link for Pro |

## Roadmap

- More practice scenes beyond the job interview: salary negotiation, first day at work, calls with HR.
- Resume tailored to a pasted job post.
- Weekly email or SMS check-in with the new plan.
- Accounts and sync across devices for Pro users.

---

CareerPort gives career guidance, not legal or immigration advice.
