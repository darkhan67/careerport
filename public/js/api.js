// Thin client for the CareerPort API.

export async function post(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}). Try again.`);
  return data;
}

export async function getConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return { aiConfigured: true, paymentLink: null };
  }
}
