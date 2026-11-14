// Landing page: cycles the "translated career" example and wires the Pro link.
import { getConfig } from './api.js';

const EXAMPLES = [
  {
    language: 'Russian',
    lang: 'ru',
    from: 'Инженер-строитель, 9 лет, Алматы',
    now: 'Now: delivery driver in Houston',
    role: 'Civil Engineering Technician',
    facts: ['$55k–$70k a year to start', 'First offer in 3–5 months', 'No license to start. PE license later for Civil Engineer.'],
  },
  {
    language: 'Spanish',
    lang: 'es',
    from: 'Contadora pública, 7 años, Guadalajara',
    now: 'Now: cashier in Phoenix',
    role: 'Staff Accountant',
    facts: ['$55k–$68k a year to start', 'First offer in 2–4 months', 'No license needed. CPA is optional, later.'],
  },
  {
    language: 'Kazakh',
    lang: 'kk',
    from: 'Балалар дәрігері, 12 жыл, Шымкент',
    now: 'Now: home health aide in Chicago',
    role: 'Clinical Research Coordinator',
    facts: ['$50k–$65k a year to start', 'First offer in 3–6 months', 'Practicing medicine needs USMLE and residency. This role does not.'],
  },
];

const figure = document.getElementById('example');
const el = (id) => document.getElementById(id);
let index = 0;

function showExample(i) {
  const ex = EXAMPLES[i];
  el('ex-lang').textContent = `Written in ${ex.language}`;
  el('ex-from').textContent = ex.from;
  el('ex-from').lang = ex.lang;
  el('ex-now').textContent = ex.now;
  el('ex-role').textContent = ex.role;
  el('ex-facts').replaceChildren(
    ...ex.facts.map((f) => {
      const li = document.createElement('li');
      li.textContent = f;
      return li;
    }),
  );
  // Restart the write-in animation for the new example.
  figure.classList.remove('is-animating');
  void figure.offsetWidth;
  figure.classList.add('is-animating');
}

el('ex-next').addEventListener('click', () => {
  index = (index + 1) % EXAMPLES.length;
  showExample(index);
});

getConfig().then((config) => {
  if (config.paymentLink) {
    const cta = el('pro-cta');
    cta.href = config.paymentLink;
    cta.target = '_blank';
    cta.rel = 'noopener';
    cta.textContent = 'Get Pro for $19 a month';
  }
});
