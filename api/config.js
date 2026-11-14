// GET /api/config — public settings the browser needs. Never exposes keys.
import { resolveProvider } from '../lib/llm.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET.' });
  }
  const provider = resolveProvider();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    aiConfigured: Boolean(provider),
    paymentLink: process.env.STRIPE_PAYMENT_LINK || null,
  });
}
