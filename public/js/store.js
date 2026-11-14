// Everything the user creates is kept in their own browser (no account needed).
const KEY = 'careerport:v1';

const empty = () => ({
  profile: null,
  analysis: null,
  selectedRole: null,
  resume: null,
  resumeInput: null,
  interviews: [],
  plan: { week: null, done: {} },
});

export function load() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return empty();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or full storage: the app still works for this visit.
  }
}

/** Monday of the current week, e.g. "2026-11-09". Weekly plans and limits reset on it. */
export function weekKey(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
