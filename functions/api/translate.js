import { json, bad, body, notConfigured, ipKey, LANGS } from '../_lib/http.js';
import { chat } from '../_lib/ai.js';

const NAMES = { en: 'English', de: 'German', fr: 'French', it: 'Italian', es: 'Spanish', nl: 'Dutch', pl: 'Polish', pt: 'Portuguese' };

// Translate a post or answer so farmers who share a climate can read each other
export async function onRequestPost({ request, env }) {
  const b = await body(request);
  const text = String(b?.text ?? '').trim();
  if (!text) return bad('text is empty');
  if (text.length > 2000) return bad('text too long');
  const to = String(b.to || '').slice(0, 2);
  if (!LANGS.includes(to)) return bad('unsupported language');
  const ip = await ipKey(request, env);
  if (!ip) return notConfigured();
  const r = await chat(env, env.DB, ip, {
    model: env.AI_MODEL_FAST || env.AI_MODEL,
    max_tokens: Math.min(600, Math.ceil(text.length / 2) + 40),
    messages: [
      { role: 'system', content: `Translate the farmer's message into ${NAMES[to]}. Keep numbers, units, names and crop varieties exactly. Output only the translation.` },
      { role: 'user', content: text },
    ],
  });
  if (r.paused) return json({ paused: r.paused });
  return json({ text: String(r.message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), cached: r.cached });
}
