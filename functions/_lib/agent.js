// "Ask Crossfarm": Nemotron answers a farmer's question with tools over the field data
// the app already computed. The tools never invent data: they return parts of `field`.
import { chat } from './ai.js';
import { estimate, headroom, preconditions } from './budget.js';

const MAX_ROUNDS = 4;

const fn = (name, description, crop = false) => ({
  type: 'function',
  function: {
    name, description,
    parameters: crop
      ? { type: 'object', properties: { crop: { type: 'string', description: 'crop id or name, optional' } } }
      : { type: 'object', properties: {} },
  },
});

export const TOOLS = [
  fn('get_climate', 'Climate at this field: 1991-2020 baseline against the 2040s (2035-2049 model mean): temperature, rain, hot days, dry spells, frost.'),
  fn('get_soil', 'Topsoil at this field from SoilGrids: pH, texture, organic carbon.'),
  fn('get_greenness', 'Satellite greenness (MODIS NDVI) of this field: recent months and the peak month since 2001.'),
  fn('get_crop_scores', 'Crop suitability scores out of 100, today and in the 2040s, with the main limit. Optionally for one crop.', true),
  fn('get_future_climate_places', 'Places whose climate today matches this field at +2 °C of global warming (climate analogues), with distance and sigma.'),
  fn('find_farmer_discussions', 'Community discussions, marked when the poster farms this field\'s future climate today. Optionally for one crop.', true),
];

const SYSTEM = `You are Crossfarm, an assistant for farmers. You answer one question about one field.
Rules:
- Answer in the language of the question. Plain words, under 150 words. Plain text only: no Markdown, no asterisks, no headings.
- Use the tools to get the field's data. Use only numbers that appear in tool results, with their labels ("2040s", "out of 100", "model output").
- If the data cannot answer the question, say so plainly. Never guess yields, prices or dates.
- Describe only changes the tool results show (warmer, drier, more hot days). If you did not fetch the climate, do not describe it.
- Crop scores are a screening from climate and soil, not a forecast.
- End with whom to ask: name the future-climate place (region and country) from the tools where farmers already work this field's future climate.
- Discussions with "demo": true are fictional examples: do not recommend asking the people in them. You may quote what such a thread discusses, saying it is a demo thread. Recommend a person only from a discussion without "demo".`;

const norm = (s) => String(s || '').toLowerCase();

export function runTool(name, args, field) {
  const crop = norm(args?.crop);
  const pick = (list) => (crop ? list.filter((x) => norm(x.id) === crop || norm(x.name) === crop || norm(x.crop) === crop) : list);
  switch (name) {
    case 'get_climate': return field.climate ?? { missing: 'no climate data' };
    case 'get_soil': return field.soil ?? { missing: 'no soil data at this point' };
    case 'get_greenness': return field.ndvi ?? { missing: 'no satellite greenness at this point' };
    case 'get_crop_scores': {
      const l = pick(field.crops || []);
      return l.length ? l : { missing: `no score for ${args?.crop}`, available: (field.crops || []).map((c) => c.name) };
    }
    case 'get_future_climate_places': return field.analogue ?? { missing: 'no analogue data' };
    case 'find_farmer_discussions': {
      const l = pick(field.threads || []);
      return l.length ? l : { missing: 'no matching discussions yet' };
    }
    default: return { error: `unknown tool ${name}` };
  }
}

// Numbers in the answer that appear in no tool result (rounding allowed)
const SKIP = new Set([100, 1991, 2020, 2035, 2040, 2049, 2]);
export function ungrounded(answer, toolTexts) {
  const nums = (s) => (String(s).match(/-?\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
  const known = toolTexts.flatMap(nums);
  const text = String(answer).replace(/^\s*\d+[.)]\s/gm, '');   // list markers
  return nums(text).filter((n) => !SKIP.has(Math.abs(n)) && !known.some((m) =>
    Math.abs(m - n) < 1e-9 || Math.abs(Math.abs(m) - Math.abs(n)) < 1e-9
    || Math.round(m) === n || Math.round(m * 10) / 10 === n || Math.round(Math.abs(m) * 100) === Math.abs(n)));
}

// Reasoning blocks never reach the farmer, closed or cut off
export const clean = (s) => String(s || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

// A demo person named without "demo" or "fictional" close by gets an explicit note:
// the model sometimes drops the label, and a farmer must never go looking for a fictional person.
export function demoNote(answer, field) {
  const names = (field.threads || []).map((t) => String(t.who || ''))
    .filter((w) => /\(demo/i.test(w)).map((w) => w.replace(/\s*\(demo.*$/i, '').trim()).filter(Boolean);
  const missing = [...new Set(names)].filter((n) => {
    const i = answer.indexOf(n);
    return i >= 0 && !/demo|fictional|fictief|fiktiv|fittizi|ficticio|fictif/i.test(answer.slice(i, i + n.length + 40));
  });
  return missing.length ? `${answer}\n\nNote: ${missing.join(', ')} ${missing.length > 1 ? 'are from fictional demo threads, not real farmers' : 'is from a fictional demo thread, not a real farmer'}.` : answer;
}

const MAX_CALLS_PER_ROUND = 4;
const MAX_TOOL_CHARS = 10000;   // all tool results of one question together

export async function ask(env, db, ip, question, field) {
  const t0 = Date.now();
  const deadline = Number.parseInt(env.AI_QUESTION_MS, 10) > 0 ? Number.parseInt(env.AI_QUESTION_MS, 10) : 40000;
  const pre = preconditions(env, ip);
  if (pre) return { paused: pre };
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Field: ${field.farm?.name || 'a field'}, ${field.farm?.region || ''} ${field.farm?.country || ''}. Usually grown: ${field.farm?.family || 'unknown'}.\nQuestion: ${question}` },
  ];
  // Refuse up front a question that could not finish: rounds grow as tool results come back
  const maxTokens = 600;
  const need = MAX_ROUNDS * (estimate(messages, TOOLS, maxTokens) + Math.ceil(MAX_TOOL_CHARS / 2.5));
  const room = await headroom(env, db, ip);
  if (room.tokens < need) return { paused: room.reason };
  if (room.calls < MAX_ROUNDS) return { paused: 'ip' };

  const used = [], texts = [], seen = new Set();
  let toolChars = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const left = deadline - (Date.now() - t0);
    if (left <= 0) return { paused: 'deadline' };
    const last = round === MAX_ROUNDS - 1;
    // Nebius documents tool_choice "auto" and forced calls only, so the last round asks in words
    if (last) messages.push({ role: 'user', content: 'Answer the question now with the data above. Do not call any more tools.' });
    const r = await chat(env, db, ip, { model: env.AI_MODEL, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: maxTokens, timeoutMs: Math.min(25000, left) });
    if (r.paused) return { paused: r.paused };
    const calls = last ? [] : (r.message.tool_calls || []).slice(0, MAX_CALLS_PER_ROUND);
    if (!calls.length) {
      const answer = demoNote(clean(r.message.content), field);
      if (!answer) return { paused: 'empty' };
      // rounds: model calls for this question, tool rounds plus the answering one
      return { answer, used, rounds: round + 1, numbers: ungrounded(answer, texts).length ? 'unverified' : 'ok', cut: r.finish === 'length' };
    }
    // only the calls that get an answer go back into the conversation
    messages.push({ role: 'assistant', content: r.message.content || '', tool_calls: calls });
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* keep empty */ }
      const name = c.function?.name;
      const sig = `${name}:${JSON.stringify(args)}`;
      let out;
      if (seen.has(sig)) out = '{"note":"already provided above"}';
      else if (toolChars >= MAX_TOOL_CHARS) out = '{"note":"data budget for this question used up, answer with what you have"}';
      else {
        out = JSON.stringify(runTool(name, args, field));
        if (toolChars + out.length > MAX_TOOL_CHARS) out = out.slice(0, MAX_TOOL_CHARS - toolChars) + ' [cut]';
        toolChars += out.length;
        seen.add(sig);
        if (!used.includes(name)) used.push(name);
        texts.push(out);
      }
      messages.push({ role: 'tool', tool_call_id: c.id, name, content: out });
    }
  }
  return { paused: 'rounds' };
}
