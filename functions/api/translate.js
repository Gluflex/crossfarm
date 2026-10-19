import { json, bad, body, notConfigured, ipKey, LANGS } from '../_lib/http.js';
import { chat } from '../_lib/ai.js';
import { clean } from '../_lib/agent.js';

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
    // Nemotron 3 Super reasons before answering by default; with a tight token limit the reasoning
    // used up every token and the translation came back empty. Translation needs no reasoning.
    max_tokens: Math.min(600, Math.ceil(text.length / 2) + 200),
    extra: { chat_template_kwargs: { enable_thinking: false } },
    messages: [
      { role: 'system', content: `Translate the farmer's message into ${NAMES[to]}. Keep numbers, units, names and crop varieties exactly. Output only the translation.` },
      { role: 'user', content: text },
    ],
  });
  if (r.paused) return json({ paused: r.paused });
  const out = clean(r.message.content);
  // never hand back an empty or cut-off text: the app would show a blank post
  if (!out || r.finish === 'length') return json({ paused: 'empty' });
  return json({ text: out, cached: r.cached });
}
