// nano-router.js: an OpenAI-compatible "router" that runs in the visitor's own browser
// on Chrome's built-in Gemini Nano (Prompt API). No API key, no server, no cost, and
// nothing the visitor types leaves the device.
//
// The Open Agentic Web runtime (nsDeploy) talks to any OpenAI-compatible
// /chat/completions endpoint. This module answers requests to NANO_ROUTER_URL
// in-page by patching fetch, translating:
//   - messages        -> a Prompt API session (system prompt + transcript)
//   - tools           -> a JSON-schema responseConstraint: either an answer or one tool call
//   - the reply       -> an OpenAI SSE stream with content or tool_calls
// so agent delegation, MCP tools and site actions keep working unchanged.

export const NANO_ROUTER_URL = 'https://gemini-nano.on-device/v1';
export const NANO_MODEL = 'gemini-nano';
export const NANO_KEY = 'on-device-no-key';

const LANGS = ['en'];

export async function nanoAvailability() {
  const LM = globalThis.LanguageModel;
  if (!LM) return 'unsupported';
  try {
    return await LM.availability({ expectedInputs: [{ type: 'text', languages: LANGS }], expectedOutputs: [{ type: 'text', languages: LANGS }] });
  } catch {
    return 'unavailable';
  }
}

/** Download the model if needed (call from a click). */
export async function prepareNano(onProgress) {
  const s = await globalThis.LanguageModel.create({
    expectedInputs: [{ type: 'text', languages: LANGS }],
    expectedOutputs: [{ type: 'text', languages: LANGS }],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
    },
  });
  s.destroy?.();
}

const stats = { calls: 0, toolCalls: 0, ms: 0, last: null };
export const nanoStats = stats;

function textOf(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return String(content);
}

function clip(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + ' …[trimmed]' : s;
}

/** Turn OpenAI-style messages into a system prompt plus a readable transcript. */
export function buildPrompt(messages, tools, budget = 14000) {
  const systems = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content));
  const rest = messages.filter((m) => m.role !== 'system');
  const toolList = (tools || []).map((t) => {
    const f = t.function || t;
    const params = f.parameters?.properties ? Object.keys(f.parameters.properties).join(', ') : '';
    return `- ${f.name}: ${clip(f.description || '', 300)}${params ? ` (arguments: ${params})` : ''}`;
  });
  let system = systems.join('\n\n');
  if (toolList.length) {
    system += `\n\nYou can call these tools. To use one, reply with {"type":"tool_call","tool":"<name>","arguments":{...}}. ` +
      `When you have what you need, reply with {"type":"answer","content":"<your reply to the user>"}. ` +
      `Call at most one tool at a time. If the user asked for several things, keep calling tools one at a time until every part is done, and only then answer. Read before you explain: never answer about data you have not read with a tool. Never invent tool results.\nTools:\n${toolList.join('\n')}`;
  } else {
    system += `\n\nReply with {"type":"answer","content":"<your reply>"}.`;
  }
  // newest messages matter most: keep the tail within budget
  const lines = [];
  let used = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i];
    let line;
    if (m.role === 'user') line = `USER: ${textOf(m.content)}`;
    else if (m.role === 'tool') line = `TOOL RESULT (${m.name || m.tool_call_id || 'tool'}): ${clip(textOf(m.content), 3000)}`;
    else if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).map((c) => `called ${c.function?.name}(${clip(c.function?.arguments, 400)})`).join('; ');
      line = `ASSISTANT: ${textOf(m.content)}${calls ? ` [${calls}]` : ''}`;
    } else line = `${String(m.role).toUpperCase()}: ${textOf(m.content)}`;
    if (used + line.length > budget && lines.length) break;
    lines.unshift(line);
    used += line.length;
  }
  return { system: clip(system, budget), transcript: lines.join('\n\n') };
}

/** JSON schema the model must follow: an answer, or a call to one of the listed tools. */
export function replySchema(tools) {
  const names = (tools || []).map((t) => (t.function || t).name).filter(Boolean);
  const props = {
    type: { type: 'string', enum: names.length ? ['answer', 'tool_call'] : ['answer'] },
    content: { type: 'string' },
  };
  if (!names.length) return { type: 'object', properties: props, required: ['type'] };
  // One variant per tool, so the model can only produce arguments that fit that tool.
  const variants = (tools || []).map((t) => {
    const f = t.function || t;
    const params = f.parameters && f.parameters.type === 'object' ? f.parameters : { type: 'object', properties: {} };
    return {
      type: 'object',
      properties: { type: { type: 'string', enum: ['tool_call'] }, tool: { type: 'string', enum: [f.name] }, arguments: params },
      required: ['type', 'tool', 'arguments'],
    };
  });
  variants.push({ type: 'object', properties: { type: { type: 'string', enum: ['answer'] }, content: { type: 'string' } }, required: ['type', 'content'] });
  return { anyOf: variants };
}

/** Parse and sanity-check the model's JSON reply. */
export function parseReply(raw, tools) {
  let obj;
  try {
    obj = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, ''));
  } catch {
    return { type: 'answer', content: String(raw).trim() };
  }
  const names = new Set((tools || []).map((t) => (t.function || t).name));
  if (obj.type === 'tool_call' && names.has(obj.tool)) {
    const fn = (tools || []).find((t) => (t.function || t).name === obj.tool);
    const params = (fn.function || fn).parameters;
    let args = obj.arguments && typeof obj.arguments === 'object' ? obj.arguments : {};
    // Agents in a network usually take a single free-text "inquiry"; fill it if the model forgot.
    const req = params?.required || [];
    for (const k of req) {
      if (args[k] == null && params.properties?.[k]?.type === 'string') args[k] = obj.content || '';
    }
    return { type: 'tool_call', tool: obj.tool, arguments: args };
  }
  const content = String(obj.content ?? '').trim();
  // Small models sometimes write a tool call into the answer text instead of making it,
  // like: [website_pin_note{"title": "...", "body": "..."}]. Make that call for real.
  const embedded = findEmbeddedCall(content, tools);
  if (embedded) return embedded;
  return { type: 'answer', content: content || 'Sorry, I could not work that out.' };
}

function findEmbeddedCall(text, tools) {
  for (const t of tools || []) {
    const name = (t.function || t).name;
    const at = text.indexOf(name);
    if (at < 0) continue;
    const brace = text.indexOf('{', at + name.length);
    if (brace < 0 || brace - (at + name.length) > 3) continue;
    // find the matching closing brace
    let depth = 0;
    let inStr = false;
    for (let i = brace; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const args = JSON.parse(text.slice(brace, i + 1).replace(/\n/g, '\\n'));
          return { type: 'tool_call', tool: name, arguments: args };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function sse(chunks, model, route) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(c)}\n\n`));
      ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      ctrl.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Nsdeploy-LLM-Route': route } });
}

function chunk(id, model, delta, finish = null) {
  return { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }] };
}

/** Run one chat completion on Gemini Nano and return OpenAI-style SSE. */
export async function completeOnDevice(req, signal) {
  const LM = globalThis.LanguageModel;
  if (!LM) throw new Error('Gemini Nano is not available in this browser.');
  const t0 = performance.now();
  const { system, transcript } = buildPrompt(req.messages || [], req.tools);
  const session = await LM.create({
    initialPrompts: [{ role: 'system', content: system }],
    expectedInputs: [{ type: 'text', languages: LANGS }],
    expectedOutputs: [{ type: 'text', languages: LANGS }],
    signal,
  });
  try {
    const raw = await session.prompt(`${transcript}\n\nReply now as JSON.`, { responseConstraint: replySchema(req.tools), signal });
    const reply = parseReply(raw, req.tools);
    const id = `nano-${Date.now().toString(36)}`;
    stats.calls++;
    stats.ms += performance.now() - t0;
    stats.last = reply.type === 'tool_call' ? `tool ${reply.tool}` : 'answer';
    if (reply.type === 'tool_call') {
      stats.toolCalls++;
      return sse(
        [
          chunk(id, NANO_MODEL, { role: 'assistant', content: null, tool_calls: [{ index: 0, id: `call_${id}`, type: 'function', function: { name: reply.tool, arguments: JSON.stringify(reply.arguments) } }] }),
          chunk(id, NANO_MODEL, {}, 'tool_calls'),
        ],
        NANO_MODEL,
        'gemini-nano-on-device',
      );
    }
    // stream the answer a few words at a time so the chat feels live
    const words = reply.content.split(/(\s+)/);
    const parts = [];
    for (let i = 0; i < words.length; i += 8) parts.push(words.slice(i, i + 8).join(''));
    return sse(
      [chunk(id, NANO_MODEL, { role: 'assistant' }), ...parts.map((p) => chunk(id, NANO_MODEL, { content: p })), chunk(id, NANO_MODEL, {}, 'stop')],
      NANO_MODEL,
      'gemini-nano-on-device',
    );
  } finally {
    session.destroy?.();
  }
}

/** Patch fetch so requests to NANO_ROUTER_URL are answered on the device. */
export function installNanoRouter() {
  if (globalThis.__nanoRouterInstalled) return;
  globalThis.__nanoRouterInstalled = true;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    if (url && url.startsWith(NANO_ROUTER_URL)) {
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ object: 'list', data: [{ id: NANO_MODEL, object: 'model', owned_by: 'chrome-built-in-ai' }] }), { headers: { 'Content-Type': 'application/json' } });
      }
      const bodyText = init.body ?? (input instanceof Request ? await input.clone().text() : '{}');
      const req = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText;
      try {
        return await completeOnDevice(req, init.signal);
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        return new Response(JSON.stringify({ error: { message: `On-device model error: ${e?.message || e}` } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return realFetch(input, init);
  };
}
