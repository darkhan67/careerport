// CareerPort app: profile → career paths → resume → mock interview → progress.
import { getConfig, post } from './api.js';
import { load, save, weekKey } from './store.js';
import { canListen, canSpeak, createRecognizer, speak, stopSpeaking } from './voice.js';

const FREE_INTERVIEWS_PER_WEEK = 2;
const FREE_MATCHES_PER_WEEK = 3;
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas',
  'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming',
];
const KIND_LABEL = {
  bridge: 'Fastest start',
  target: 'Your profession in the US',
  stretch: 'Higher ceiling',
};

const state = load();
let config = { aiConfigured: true, paymentLink: null };
let session = null; // the interview in progress
let recognizer = null;

const $ = (selector, root = document) => root.querySelector(selector);

/** Builds DOM safely: AI text is always inserted as text, never as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/** Replaces an element's content; accepts nested arrays and skips empty values. */
function mount(root, ...children) {
  root.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false && c !== ''));
}

const persist = () => save(state);

function formatMinutes(min) {
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function setStatus(el, message, isError = false) {
  el.textContent = message;
  el.classList.toggle('is-error', isError);
}

/** Disables a button while an async action runs and reports errors next to it. */
async function busy(button, busyLabel, statusEl, action) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  setStatus(statusEl, '');
  try {
    await action();
  } catch (err) {
    setStatus(statusEl, err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function readForm(form) {
  const values = {};
  for (const [key, value] of new FormData(form)) values[key] = typeof value === 'string' ? value.trim() : value;
  return values;
}

function emptyState(title, text, actionLabel, href) {
  return h('div', { class: 'empty' },
    h('h2', {}, title),
    h('p', {}, text),
    h('a', { class: 'btn btn--primary', href }, actionLabel),
  );
}

function roles() {
  return state.analysis?.paths.map((p) => p.title) ?? [];
}

function selectRole(title) {
  state.selectedRole = title;
  persist();
}

function preferredRole() {
  return state.selectedRole || roles()[0] || '';
}

function fillRoleList() {
  $('#role-list').replaceChildren(...roles().map((r) => h('option', { value: r })));
}

/* ---------------- routing ---------------- */

const VIEWS = ['profile', 'paths', 'resume', 'match', 'interview', 'progress'];
const RENDER = {
  match: renderMatch,
  profile: renderProfile,
  paths: renderPaths,
  resume: renderResume,
  interview: renderInterview,
  progress: renderProgress,
};

function currentView() {
  const view = location.hash.slice(1);
  if (VIEWS.includes(view)) return view;
  return state.analysis ? 'paths' : 'profile';
}

function show(view) {
  for (const v of VIEWS) {
    $(`#view-${v}`).hidden = v !== view;
    $(`[data-tab="${v}"]`).setAttribute('aria-current', v === view ? 'page' : 'false');
  }
  if (view !== 'interview') {
    stopSpeaking();
    if (recognizer?.listening) recognizer.stop();
  }
  $(`[data-tab="${view}"]`).scrollIntoView({ block: 'nearest', inline: 'center' });
  fillRoleList();
  RENDER[view]();
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', () => show(currentView()));

/* ---------------- profile ---------------- */

const profileForm = $('#profile-form');
$('#f-state').append(
  h('option', { value: '' }, 'Choose a state'),
  ...US_STATES.map((s) => h('option', { value: s }, s)),
);

function renderProfile() {
  if (!state.profile || profileForm.dataset.filled) return;
  for (const [key, value] of Object.entries(state.profile)) {
    const field = profileForm.elements[key];
    if (field && value != null) field.value = value;
  }
  profileForm.dataset.filled = 'true';
}

function validateProfile(profile) {
  const missing = [];
  if (!profile.profession) missing.push('your profession');
  if (!profile.homeCountry) missing.push('the country where you worked');
  if (!profile.education) missing.push('your education');
  if (!profile.state) missing.push('your US state');
  return missing.length ? `Add ${missing.join(', ')} to continue.` : '';
}

profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const profile = readForm(profileForm);
  profile.yearsExperience = Number(profile.yearsExperience) || 0;
  profile.hoursPerWeek = Number(profile.hoursPerWeek) || 5;
  const status = $('#profile-status');
  const problem = validateProfile(profile);
  if (problem) {
    setStatus(status, problem, true);
    return;
  }
  busy(event.submitter || $('[type=submit]', profileForm), 'Mapping your experience…', status, async () => {
    setStatus(status, 'This takes about 30 seconds.');
    const analysis = await post('/api/analyze', { profile });
    Object.assign(state, {
      profile,
      analysis,
      selectedRole: analysis.paths[0]?.title || null,
      plan: { week: weekKey(), done: {} },
    });
    persist();
    location.hash = '#paths';
  });
});

/* ---------------- career paths ---------------- */

function onetLink(title) {
  return `https://www.onetonline.org/find/quick?s=${encodeURIComponent(title)}`;
}

function fact(label, value) {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value || 'Not sure'));
}

function pathCard(path, index) {
  return h('article', { class: `path path--${path.kind}`, 'aria-labelledby': `path-${index}` },
    h('p', { class: 'path-kind' }, KIND_LABEL[path.kind]),
    h('h2', { class: 'path-title', id: `path-${index}` }, path.title),
    h('dl', { class: 'facts' },
      fact('Starting pay', path.salary),
      fact('First offer in', path.timeToOffer),
      fact('Upfront cost', path.cost),
      fact('License', path.license.required ? 'Required' : 'Not required'),
    ),
    path.license.note && h('p', { class: `license${path.license.required ? ' license--required' : ''}` }, path.license.note),
    path.why && h('p', {}, path.why),
    path.steps.length > 0 && h('details', { open: index === 0 },
      h('summary', {}, 'Next steps'),
      h('ol', {}, path.steps.map((s) => h('li', {}, s))),
    ),
    path.gaps.length > 0 && h('details', {},
      h('summary', {}, 'What you still need'),
      h('ul', {}, path.gaps.map((g) => h('li', {}, g))),
    ),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn--primary btn--small', href: '#resume', onclick: () => selectRole(path.title) }, 'Write my resume for this'),
      h('a', { class: 'btn btn--small', href: '#interview', onclick: () => selectRole(path.title) }, 'Practice this interview'),
    ),
    h('p', { class: 'source' },
      'Pay and timing are estimates. ',
      h('a', { href: onetLink(path.title), target: '_blank', rel: 'noopener' }, 'Check official pay data on O*NET'),
    ),
  );
}

function ensureCurrentWeek() {
  const week = weekKey();
  if (state.plan.week !== week) {
    state.plan = { week, done: {} };
    persist();
  }
}

function planBlock() {
  const tasks = state.analysis.weeklyPlan;
  if (!tasks.length) return null;
  ensureCurrentWeek();
  const doneCount = () => tasks.filter((_, i) => state.plan.done[i]).length;
  const meter = h('progress', { max: tasks.length, value: doneCount(), 'aria-label': 'Tasks done this week' });
  const counter = h('span', {}, `${doneCount()} of ${tasks.length} done`);
  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);

  return h('section', { class: 'plan', 'aria-labelledby': 'plan-h' },
    h('div', { class: 'plan-head' },
      h('h2', { id: 'plan-h' }, 'Your plan for this week'),
      h('p', {}, `About ${formatMinutes(total)} in total, within your ${state.profile.hoursPerWeek} hours.`),
    ),
    h('div', { class: 'plan-meter' }, meter, counter),
    h('ul', { class: 'checklist' }, tasks.map((task, i) => {
      const box = h('input', {
        type: 'checkbox',
        id: `task-${i}`,
        onchange: (e) => {
          state.plan.done[i] = e.target.checked;
          persist();
          meter.value = doneCount();
          counter.textContent = `${doneCount()} of ${tasks.length} done`;
        },
      });
      box.checked = Boolean(state.plan.done[i]);
      return h('li', {}, box, h('label', { for: `task-${i}` }, task.task, h('span', { class: 'mins' }, formatMinutes(task.minutes))));
    })),
  );
}

function renderPaths() {
  const root = $('#paths-root');
  const a = state.analysis;
  if (!a) {
    mount(root, emptyState(
      'Start with your profile',
      'Tell us what you did before you moved, and we will find the US jobs that match it.',
      'Fill in my profile',
      '#profile',
    ));
    return;
  }
  mount(root,
    h('header', { class: 'view-head' },
      h('h1', {}, state.profile?.firstName ? `${state.profile.firstName}, here are your US paths` : 'Your US career paths'),
      a.summary && h('p', { class: 'lede' }, a.summary),
    ),
    a.strengths.length > 0 && h('section', { class: 'strengths', 'aria-labelledby': 'strengths-h' },
      h('h2', { id: 'strengths-h' }, 'What already transfers'),
      h('ul', { class: 'tags' }, a.strengths.map((s) => h('li', {}, s))),
    ),
    h('div', { class: 'paths' }, a.paths.map(pathCard)),
    a.credentials && h('section', { class: 'note-block', 'aria-labelledby': 'cred-h' },
      h('h2', { id: 'cred-h' }, 'Your diploma in the US'),
      h('p', {}, a.credentials),
    ),
    planBlock(),
  );
}

/* ---------------- resume ---------------- */

const resumeForm = $('#resume-form');

function renderResume() {
  const ready = Boolean(state.analysis);
  $('#resume-main').hidden = !ready;
  mount($('#resume-empty'), !ready && emptyState(
    'Your resume needs your profile',
    'Fill in your profile first, so we know which roles to write it for.',
    'Fill in my profile',
    '#profile',
  ));
  if (!ready) return;

  const input = state.resumeInput || {};
  for (const key of ['experience', 'name', 'city', 'email', 'phone']) {
    if (input[key] && !resumeForm.elements[key].value) resumeForm.elements[key].value = input[key];
  }
  resumeForm.elements.role.value = preferredRole();
  if (!input.name && state.profile?.firstName && !resumeForm.elements.name.value) {
    resumeForm.elements.name.value = state.profile.firstName;
  }
  renderResumeSheet();
}

resumeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = readForm(resumeForm);
  const status = $('#resume-status');
  if (!data.role) {
    setStatus(status, 'Add the role you are applying for.', true);
    return;
  }
  busy(event.submitter || $('[type=submit]', resumeForm), 'Writing your resume…', status, async () => {
    setStatus(status, 'This takes about 20 seconds.');
    const resume = await post('/api/resume', {
      profile: state.profile,
      role: data.role,
      contact: { name: data.name, email: data.email, phone: data.phone, city: data.city },
      experience: data.experience,
    });
    state.resume = { role: data.role, ...resume };
    state.resumeInput = data;
    selectRole(data.role);
    persist();
    renderResumeSheet();
    setStatus(status, 'Your resume is ready.');
    $('#resume-output').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

function resumeAsText(r) {
  const lines = [r.name, r.headline, r.contact, '', 'SUMMARY', r.summary, ''];
  if (r.skills.length) lines.push('SKILLS', r.skills.join(', '), '');
  if (r.experience.length) {
    lines.push('EXPERIENCE');
    for (const job of r.experience) {
      lines.push([job.title, job.company].filter(Boolean).join(', '), [job.location, job.dates].filter(Boolean).join(' | '));
      for (const b of job.bullets) lines.push(`- ${b}`);
      lines.push('');
    }
  }
  if (r.education.length) {
    lines.push('EDUCATION');
    for (const e of r.education) {
      lines.push([e.degree, e.school].filter(Boolean).join(', '), [e.location, e.year].filter(Boolean).join(' | '));
      if (e.note) lines.push(e.note);
    }
    lines.push('');
  }
  if (r.certifications.length) lines.push('CERTIFICATIONS', ...r.certifications);
  return lines.filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n').trim();
}

function renderResumeSheet() {
  const out = $('#resume-output');
  const r = state.resume;
  if (!r) {
    mount(out, h('div', { class: 'empty' },
      h('h2', {}, 'Your resume will appear here'),
      h('p', {}, 'Add your experience on the left and press "Build my US resume".'),
    ));
    return;
  }
  const status = h('span', { class: 'small muted', role: 'status' });
  mount(out,
    h('div', { class: 'toolbar' },
      h('button', {
        class: 'btn btn--small',
        type: 'button',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(resumeAsText(r));
            status.textContent = 'Copied. Paste it into a job application or a Word file.';
          } catch {
            status.textContent = 'Copy is blocked in this browser. Select the text and copy it by hand.';
          }
        },
      }, 'Copy as text'),
      h('button', { class: 'btn btn--small', type: 'button', onclick: () => window.print() }, 'Save as PDF'),
      status,
    ),
    h('article', { class: 'resume-sheet', 'aria-label': `Resume for ${r.role}` },
      h('h2', {}, r.name || 'Your Name'),
      r.headline && h('p', { class: 'r-headline' }, r.headline),
      r.contact && h('p', { class: 'r-contact' }, r.contact),
      r.summary && [h('h3', {}, 'Summary'), h('p', {}, r.summary)],
      r.skills.length > 0 && [h('h3', {}, 'Skills'), h('p', {}, r.skills.join(', '))],
      r.experience.length > 0 && [
        h('h3', {}, 'Experience'),
        r.experience.map((job) => h('div', { class: 'r-job' },
          h('div', { class: 'r-job-head' },
            h('span', {}, h('strong', {}, job.title), job.company && `, ${job.company}`),
            h('span', { class: 'r-job-meta' }, [job.location, job.dates].filter(Boolean).join(' | ')),
          ),
          job.bullets.length > 0 && h('ul', {}, job.bullets.map((b) => h('li', {}, b))),
        )),
      ],
      r.education.length > 0 && [
        h('h3', {}, 'Education'),
        r.education.map((e) => h('div', { class: 'r-job' },
          h('div', { class: 'r-job-head' },
            h('span', {}, h('strong', {}, e.degree), e.school && `, ${e.school}`),
            h('span', { class: 'r-job-meta' }, [e.location, e.year].filter(Boolean).join(' | ')),
          ),
          e.note && h('p', { class: 'placeholder-note' }, e.note),
        )),
      ],
      r.certifications.length > 0 && [h('h3', {}, 'Certifications'), h('ul', {}, r.certifications.map((c) => h('li', {}, c)))],
    ),
    r.notes.length > 0 && h('section', { class: 'notes', 'aria-labelledby': 'notes-h' },
      h('h3', { id: 'notes-h' }, 'Before you send it'),
      h('ul', {}, r.notes.map((n) => h('li', {}, n))),
    ),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn--primary', href: '#interview', onclick: () => selectRole(r.role) }, 'Practice the interview for this role'),
    ),
  );
}

/* ---------------- job match ---------------- */

const matchForm = $('#match-form');

function matchesThisWeek() {
  const week = weekKey();
  return state.matches.filter((m) => weekKey(new Date(m.date)) === week).length;
}

function copyButton(label, getText) {
  const note = h('span', { class: 'small muted', role: 'status' });
  const button = h('button', {
    class: 'btn btn--small',
    type: 'button',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(getText());
        note.textContent = 'Copied.';
      } catch {
        note.textContent = 'Copy is blocked in this browser. Select the text and copy it by hand.';
      }
    },
  }, label);
  return h('div', { class: 'toolbar' }, button, note);
}

function practiceForJob(record) {
  const role = record.result.role || preferredRole();
  state.interviewJob = { role, company: record.result.company, jobPost: record.jobPost };
  selectRole(role);
  setupForm.elements.role.value = role;
}

function renderMatch() {
  const ready = Boolean(state.profile);
  $('#match-main').hidden = !ready;
  mount($('#match-empty'), !ready && emptyState(
    'Job matching needs your profile',
    'Fill in your profile first, so we can compare your experience with the job.',
    'Fill in my profile',
    '#profile',
  ));
  if (!ready) return;
  const last = state.matches[0];
  if (last && !matchForm.elements.jobPost.value) matchForm.elements.jobPost.value = last.jobPost;
  renderMatchResult(last);
}

function renderMatchResult(record) {
  const out = $('#match-output');
  if (!record) {
    mount(out, h('div', { class: 'empty' },
      h('h2', {}, 'Your match will appear here'),
      h('p', {}, 'Paste a job post on the left and press "Check my match".'),
    ));
    return;
  }
  const m = record.result;
  mount(out, h('article', { class: 'match', 'aria-labelledby': 'match-title' },
    h('p', { class: 'path-kind' }, `Checked ${formatDate(record.date)}`),
    h('h2', { class: 'match-title', id: 'match-title' }, [m.role, m.company].filter(Boolean).join(' at ') || 'This job'),
    h('div', { class: 'score-block' },
      h('p', { class: 'score', 'aria-label': `Match ${m.matchScore} out of 100` }, String(m.matchScore), h('small', {}, ' / 100 match')),
      m.verdict && h('p', {}, m.verdict),
    ),
    h('div', { class: 'two-col' },
      m.matches.length > 0 && h('div', {}, h('h3', {}, 'You already have'), h('ul', {}, m.matches.map((x) => h('li', {}, x)))),
      m.gaps.length > 0 && h('div', {}, h('h3', {}, 'What is missing'), h('ul', {}, m.gaps.map((g) => h('li', {},
        h('strong', {}, g.gap),
        g.how && h('span', { class: 'fix-why' }, g.how),
      )))),
    ),
    m.keywords.length > 0 && h('section', { class: 'match-block' },
      h('h3', {}, 'Words to use in your resume'),
      h('ul', { class: 'tags' }, m.keywords.map((k) => h('li', {}, k))),
    ),
    (m.summary || m.bullets.length > 0) && h('section', { class: 'match-block' },
      h('h3', {}, 'Your resume, tuned for this job'),
      m.summary && h('p', {}, m.summary),
      m.bullets.length > 0 && h('ul', { class: 'match-list' }, m.bullets.map((b) => h('li', {}, b))),
      copyButton('Copy summary and bullets', () => [m.summary, ...m.bullets.map((b) => `- ${b}`)].filter(Boolean).join('\n')),
    ),
    m.coverNote && h('section', { class: 'match-block' },
      h('h3', {}, 'Cover note'),
      h('p', { class: 'cover-note' }, m.coverNote),
      copyButton('Copy cover note', () => m.coverNote),
    ),
    h('p', { class: 'placeholder-note' }, 'Replace every [X] with your real numbers before you send anything.'),
    m.questions.length > 0 && h('section', { class: 'match-block' },
      h('h3', {}, 'Questions they will likely ask'),
      h('ol', { class: 'match-list' }, m.questions.map((q) => h('li', {}, q))),
    ),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn--primary', href: '#interview', onclick: () => practiceForJob(record) }, 'Practice the interview for this job'),
    ),
  ));
}

matchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter || $('[type=submit]', matchForm);
  const status = $('#match-status');
  const jobPost = matchForm.elements.jobPost.value.trim();
  if (jobPost.length < 80) {
    setStatus(status, 'Paste the whole job post, including the requirements.', true);
    return;
  }
  if (matchesThisWeek() >= FREE_MATCHES_PER_WEEK && !(await askToUpgrade('match'))) return;
  busy(button, 'Reading the job post…', status, async () => {
    setStatus(status, 'This takes about 30 seconds.');
    const result = await post('/api/match', {
      profile: state.profile,
      jobPost,
      resumeText: state.resume ? resumeAsText(state.resume) : '',
    });
    const record = { id: Date.now().toString(36), date: new Date().toISOString(), jobPost, result };
    state.matches = [record, ...state.matches].slice(0, 10);
    persist();
    setStatus(status, '');
    renderMatchResult(record);
    $('#match-output').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ---------------- interview ---------------- */

const setupForm = $('#interview-setup');
const composer = $('#composer');
const answerEl = $('#answer');
const micBtn = $('#mic');

function interviewsThisWeek() {
  const week = weekKey();
  return state.interviews.filter((i) => weekKey(new Date(i.date)) === week).length;
}

function renderInterview() {
  if (!session) {
    setupForm.hidden = false;
    $('#interview-live').hidden = true;
    if (!setupForm.elements.role.value) setupForm.elements.role.value = preferredRole();
  }
  const hints = [];
  if (!canListen) hints.push('Voice answers work in Chrome, Edge and Safari. Here you can type your answers.');
  if (!canSpeak) $('#i-speak').closest('.switch').hidden = true;
  if (!state.profile) hints.push('Tip: fill in your profile first, so the questions match your experience.');
  $('#voice-hint').textContent = hints.join(' ');
  micBtn.hidden = !canListen;

  const job = state.interviewJob;
  $('#job-context').hidden = !job;
  if (job) {
    $('#job-context-text').textContent = `Questions will follow the job post for ${[job.role, job.company].filter(Boolean).join(' at ')}.`;
  }
}

$('#job-context-clear').addEventListener('click', () => {
  state.interviewJob = null;
  persist();
  renderInterview();
});

const UPGRADE_TEXT = {
  interview: {
    title: "You've used this week's free interviews",
    text: 'Free includes two mock interviews a week. Pro gives you unlimited practice with feedback for $19 a month. Cancel anytime.',
  },
  match: {
    title: "You've used this week's free job checks",
    text: 'Free includes three job post checks a week. Pro gives you unlimited checks with a tailored resume and cover note for $19 a month. Cancel anytime.',
  },
};

function askToUpgrade(kind = 'interview') {
  const dialog = $('#upgrade');
  $('#upgrade-h').textContent = UPGRADE_TEXT[kind].title;
  $('#upgrade-text').textContent = UPGRADE_TEXT[kind].text;
  if (config.paymentLink) {
    $('#upgrade-pro').href = config.paymentLink;
    $('#upgrade-pro').textContent = 'Get Pro for $19 a month';
  }
  return new Promise((resolve) => {
    const keep = () => {
      dialog.close();
      resolve(true);
    };
    $('#upgrade-continue').addEventListener('click', keep, { once: true });
    dialog.addEventListener('close', () => resolve(false), { once: true });
    dialog.showModal();
  });
}

function renderTranscript() {
  const asked = session.transcript.filter((t) => t.from === 'interviewer').length;
  $('#question-count').textContent = session.done
    ? 'Interview finished'
    : `Question ${Math.max(asked, 1)} of ${session.total}`;
  mount($('#transcript'),
    session.transcript.map((turn) => h('li', { class: `turn turn--${turn.from}` },
      h('span', { class: 'turn-who' }, turn.from === 'interviewer' ? 'Interviewer' : 'You'),
      h('p', {}, turn.text),
    )),
    session.pending && h('li', { class: 'turn turn--interviewer' },
      h('span', { class: 'turn-who' }, 'Interviewer'),
      h('p', { class: 'typing', role: 'img', 'aria-label': 'The interviewer is typing' }, h('span'), h('span'), h('span')),
    ),
  );
}

function lastQuestion() {
  return [...session.transcript].reverse().find((t) => t.from === 'interviewer')?.text || '';
}

/** Asks the interviewer for the next line. Returns false if the request failed. */
async function nextTurn() {
  const status = $('#live-status');
  const send = $('#send');
  send.disabled = true;
  answerEl.disabled = true;
  setStatus(status, '');
  session.pending = true;
  renderTranscript();
  try {
    const res = await post('/api/interview', {
      role: session.role,
      profile: state.profile,
      transcript: session.transcript,
      jobPost: session.jobPost,
    });
    session.transcript.push({ from: 'interviewer', text: res.message });
    session.total = res.totalQuestions;
    session.done = res.done;
    session.pending = false;
    renderTranscript();
    if ($('#i-speak').checked) speak(res.message);
    if (session.done) {
      composer.hidden = true;
      $('#finish').hidden = false;
      $('#get-feedback').focus();
    } else {
      answerEl.focus();
    }
    return true;
  } catch (err) {
    session.pending = false;
    renderTranscript();
    setStatus(status, err.message, true);
    return false;
  } finally {
    send.disabled = false;
    answerEl.disabled = false;
  }
}

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const role = setupForm.elements.role.value.trim();
  const status = $('#setup-status');
  if (!role) {
    setStatus(status, 'Add the role you are interviewing for.', true);
    return;
  }
  if (interviewsThisWeek() >= FREE_INTERVIEWS_PER_WEEK && !(await askToUpgrade())) return;

  const job = state.interviewJob && state.interviewJob.role === role ? state.interviewJob : null;
  session = { role, transcript: [], done: false, total: 5, jobPost: job?.jobPost || '' };
  selectRole(role);
  $('#interview-feedback').replaceChildren();
  setupForm.hidden = true;
  $('#interview-live').hidden = false;
  composer.hidden = false;
  $('#finish').hidden = true;
  answerEl.value = '';
  renderTranscript();
  const ok = await nextTurn();
  if (!ok) {
    const message = $('#live-status').textContent;
    session = null;
    setupForm.hidden = false;
    $('#interview-live').hidden = true;
    setStatus(status, message, true);
  }
});

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (recognizer?.listening) recognizer.stop();
  const text = answerEl.value.trim();
  if (!text) {
    setStatus($('#live-status'), 'Say or type your answer first.', true);
    return;
  }
  stopSpeaking();
  session.transcript.push({ from: 'candidate', text });
  answerEl.value = '';
  renderTranscript();
  const ok = await nextTurn();
  if (!ok) {
    session.transcript.pop();
    renderTranscript();
    answerEl.value = text;
  }
});

answerEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) composer.requestSubmit();
});

$('#repeat').addEventListener('click', () => speak(lastQuestion()));

if (canListen) {
  recognizer = createRecognizer({
    onText: (text) => {
      answerEl.value = text;
    },
    onState: (listening, error) => {
      micBtn.setAttribute('aria-pressed', String(listening));
      $('#mic-label').textContent = listening ? 'Stop' : 'Speak';
      if (error === 'not-allowed' || error === 'service-not-allowed') {
        setStatus($('#live-status'), 'Microphone access is blocked. Allow it in the browser, or type your answer.', true);
      } else if (listening) {
        setStatus($('#live-status'), 'Listening. Press Stop when you finish.');
      } else if (!error) {
        setStatus($('#live-status'), '');
      }
    },
  });
  micBtn.addEventListener('click', () => {
    if (recognizer.listening) {
      recognizer.stop();
    } else {
      stopSpeaking();
      recognizer.start(answerEl.value.trim());
    }
  });
}

$('#get-feedback').addEventListener('click', (event) => {
  busy(event.currentTarget, 'Reviewing your answers…', $('#finish-status'), async () => {
    setStatus($('#finish-status'), 'This takes about 20 seconds.');
    const feedback = await post('/api/feedback', {
      role: session.role,
      profile: state.profile,
      transcript: session.transcript,
    });
    const record = {
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      role: session.role,
      transcript: session.transcript,
      feedback,
    };
    state.interviews = [record, ...state.interviews].slice(0, 30);
    persist();
    session = null;
    $('#interview-live').hidden = true;
    renderFeedback(record);
  });
});

function renderFeedback(record) {
  const fb = record.feedback;
  const answers = record.transcript.filter((t) => t.from === 'candidate');
  const root = $('#interview-feedback');
  mount(root,
    h('h2', {}, `Feedback: ${record.role}`),
    h('div', { class: 'score-block' },
      h('p', { class: 'score', 'aria-label': `Score ${fb.score} out of 100` }, String(fb.score), h('small', {}, ' / 100')),
      fb.verdict && h('p', {}, fb.verdict),
    ),
    h('div', { class: 'two-col' },
      fb.strengths.length > 0 && h('div', {}, h('h3', {}, 'What worked'), h('ul', {}, fb.strengths.map((s) => h('li', {}, s)))),
      fb.improve.length > 0 && h('div', {}, h('h3', {}, 'What to improve'), h('ul', {}, fb.improve.map((s) => h('li', {}, s)))),
    ),
    fb.answers.map((a, i) => h('details', { class: 'answer-review', open: i === 0 },
      h('summary', {}, h('span', {}, a.question || `Question ${i + 1}`), h('span', { class: 'answer-score' }, `${a.score}/10`)),
      answers[i] && h('p', { class: 'your-answer' }, answers[i].text),
      a.fixes.length > 0 && [
        h('h4', {}, 'Say it more naturally'),
        h('ul', { class: 'fixes' }, a.fixes.map((f) => h('li', {},
          h('span', { class: 'fix-said' }, f.said), ' ', h('span', { class: 'mark' }, f.better),
          f.why && h('span', { class: 'fix-why' }, f.why),
        ))),
      ],
      a.stronger && h('div', { class: 'stronger' }, h('h4', {}, 'A stronger answer'), h('p', {}, a.stronger)),
      a.tip && h('p', { class: 'small', style: 'margin-top:0.75rem' }, a.tip),
    )),
    fb.phrases.length > 0 && h('section', { class: 'phrases' },
      h('h3', {}, 'Phrases to learn for this role'),
      h('ul', {}, fb.phrases.map((p) => h('li', {}, p))),
    ),
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn btn--primary',
        type: 'button',
        onclick: () => {
          mount(root);
          renderInterview();
          setupForm.elements.role.value = record.role;
          setupForm.querySelector('[type=submit]').focus();
        },
      }, 'Practice again'),
      h('a', { class: 'btn', href: '#progress' }, 'See my progress'),
    ),
  );
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- progress ---------------- */

function renderProgress() {
  const root = $('#progress-root');
  if (!state.analysis && !state.interviews.length) {
    mount(root, emptyState(
      'Nothing to track yet',
      'Build your plan and do your first mock interview. Your scores will show up here.',
      'Start with my profile',
      '#profile',
    ));
    return;
  }
  const scores = state.interviews.map((i) => i.feedback.score);
  const tasks = state.analysis?.weeklyPlan ?? [];
  if (state.analysis) ensureCurrentWeek();
  const tasksDone = tasks.filter((_, i) => state.plan.done[i]).length;

  mount(root,
    h('dl', { class: 'stats' },
      h('div', { class: 'stat' }, h('dt', {}, 'Mock interviews'), h('dd', {}, String(scores.length))),
      h('div', { class: 'stat' }, h('dt', {}, 'Jobs checked'), h('dd', {}, String(state.matches.length))),
      h('div', { class: 'stat' }, h('dt', {}, 'Latest score'), h('dd', {}, scores.length ? String(scores[0]) : 'None yet')),
      h('div', { class: 'stat' }, h('dt', {}, 'Best score'), h('dd', {}, scores.length ? String(Math.max(...scores)) : 'None yet')),
      tasks.length > 0 && h('div', { class: 'stat' }, h('dt', {}, 'Plan this week'), h('dd', {}, `${tasksDone} of ${tasks.length}`)),
    ),
    state.interviews.length
      ? [
        h('h2', {}, 'Interview history'),
        h('ul', { class: 'history' }, state.interviews.map((i) => h('li', {},
          h('div', { class: 'history-row' },
            h('span', {}, h('strong', {}, i.role), h('span', { class: 'muted' }, `, ${formatDate(i.date)}`)),
            h('span', {}, `${i.feedback.score}/100`),
            h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${i.feedback.score}%` })),
          ),
          i.feedback.improve[0] && h('p', { class: 'small muted', style: 'margin:0.4rem 0 0' }, `Work on: ${i.feedback.improve[0]}`),
        ))),
      ]
      : h('div', { class: 'empty' },
        h('h2', {}, 'No interviews yet'),
        h('p', {}, 'Your first mock interview takes about 10 minutes.'),
        h('a', { class: 'btn btn--primary', href: '#interview' }, 'Start a mock interview'),
      ),
  );
}

/* ---------------- start ---------------- */

show(currentView());
getConfig().then((c) => {
  config = c;
  $('#config-banner').hidden = c.aiConfigured;
});
