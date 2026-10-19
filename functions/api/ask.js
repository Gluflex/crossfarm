import { json, bad, body, notConfigured, clip, ipKey } from '../_lib/http.js';
import { ask } from '../_lib/agent.js';

const MAX_FIELD = 12000;   // characters of field context: bounds the tokens a question can cost

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  const question = clip(b?.question, 500);
  if (!question) return bad('question is empty');
  if (!b.field || typeof b.field !== 'object') return bad('field data missing');
  if (JSON.stringify(b.field).length > MAX_FIELD) return bad('field data too large', 413);
  const ip = await ipKey(request, env);
  if (!ip) return notConfigured();
  return json(await ask(env, env.DB, ip, question, b.field));
}
