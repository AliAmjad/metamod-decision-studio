const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Node {
  constructor(tag = '#text', text = '') {
    this.tagName = tag; this.children = []; this._text = text; this.hidden = false; this.disabled = false; this.value = ''; this.firstChild = { textContent: '' }; this.listeners = {}; this.style = {};
    this.classList = { add: name => { this.className = `${this.className || ''} ${name}`; } };
  }
  append(...children) { for (const child of children) this.children.push(...(child.tagName === '#fragment' ? child.children : [child])); }
  replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute(name, value) { this[name] = value; }
  remove() { this.removed = true; }
  setCustomValidity(value) { this.validationMessage = value; }
  reportValidity() { this.validityReported = true; }
  focus() { this.focused = true; }
}
const selectors = ['#question-form', '#question', '#submit-button', '#status', '#conversation', '#empty-state', '#error', '#stop-button', '#new-conversation', '#composer-context'];
const elements = Object.fromEntries(selectors.map(selector => [selector, new Node('div')]));
const transcript = elements['#conversation'];
transcript.clientHeight = 100;
transcript.scrollTop = 0;
Object.defineProperty(transcript, 'scrollHeight', { get() { return Math.max(120, transcript.textContent.length + transcript.children.length * 30); } });
const document = { baseURI: 'https://example.invalid/', querySelector: selector => elements[selector], createElement: tag => new Node(tag), createElementNS: (_namespace, tag) => new Node(tag), createTextNode: text => new Node('#text', text), createDocumentFragment: () => new Node('#fragment') };
let responseStream;
const requests = [];
let nextSession = 0;
const timers = new Map();
let nextTimer = 0;
const context = {
  document,
  window: { METAMOD_CONFIG: { proxyEndpoint: '/api/run' } },
  crypto: { randomUUID: () => `test-session-${++nextSession}` }, URL, TextDecoder, DOMException, AbortController,
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimeout(id) { timers.delete(id); },
  fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, body: responseStream }; }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/charts.js', 'utf8'), context);
vm.runInContext(fs.readFileSync(__dirname + '/markdown.js', 'utf8'), context);
vm.runInContext(fs.readFileSync(__dirname + '/app.js', 'utf8'), context);
function visit(node, fn) { fn(node); node.children.forEach(child => visit(child, fn)); }
function frames(items, size = 3, beforeRead) {
  const bytes = new TextEncoder().encode(items.map(item => JSON.stringify(item)).join('\n') + '\n');
  let i = 0;
  return { getReader() { return {
    async read() {
      if (beforeRead) { const fn = beforeRead; beforeRead = undefined; await fn(); }
      if (i >= bytes.length) return { done: true };
      const value = bytes.slice(i, i + size); i += size; return { done: false, value };
    }, releaseLock() {}, async cancel() {}
  }; } };
}
const final = (text, sessionId, error = false) => ({ session_id: sessionId, outputs: [{ outputs: [{ results: { message: { sender: 'Machine', text, error, properties: { state: 'complete' } } }, messages: [{ sender: 'Machine', message: text }] }] }] });
const end = (text, sessionId) => ({ event: 'end', data: { result: final(text, sessionId) } });
async function submit() { await elements['#question-form'].listeners.submit({ preventDefault() {} }); }
const turns = () => transcript.children.filter(node => node.tagName === 'article');
(async () => {
  elements['#question'].value = 'First question';
  const answer = '# Hello 🌿\n\n| Option | Rating |\n| :--- | ---: |\n| **Stay** | 8 |\n| Move \\| negotiate | [Safe](https://example.com) [unsafe](javascript:alert) |';
  responseStream = frames([
    { event: 'add_message', data: { id: 'user-1', sender: 'User', text: 'First question' } },
    { event: 'add_message', data: { id: 'machine-1', sender: 'Machine', text: '# Hel', properties: { state: 'partial' }, content_blocks: [{ text: 'Agent Steps' }] } },
    { event: 'add_message', data: { id: 'machine-1', sender: 'Machine', text: '# Hel', properties: { state: 'partial' } } },
    { event: 'token', data: { id: 'machine-1', chunk: 'lo 🌿' } },
    { event: 'preamble_end', data: {} },
    { event: 'add_message', data: { id: 'machine-1', sender: 'Machine', text: answer, properties: { state: 'complete' } } },
    end(answer, 'returned-session')
  ], 7);
  await submit();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/run');
  assert.equal(JSON.parse(requests[0].options.body).session_id, 'test-session-1');
  assert.deepEqual(Object.keys(requests[0].options.headers), ['Content-Type']);
  assert.equal(turns().length, 2);
  assert.match(turns()[1].textContent, /Move \| negotiate/);
  assert(!turns()[1].textContent.includes('Agent Steps'));
  const tags = [];
  visit(turns()[1], node => tags.push(node.tagName));
  for (const tag of ['table', 'thead', 'tbody', 'th', 'td', 'strong', 'a']) assert(tags.includes(tag), `${tag} should be rendered`);
  let unsafeLink = false, rightAligned = false;
  visit(turns()[1], node => { if (node.tagName === 'a' && node.textContent === 'unsafe') unsafeLink = true; if (node.tagName === 'th' && node.textContent === 'Rating') rightAligned = node.style.textAlign === 'right'; });
  assert(!unsafeLink && rightAligned);
  // The mixed-content table is intentionally not charted: only strictly numeric columns qualify.
  assert(!tags.includes('svg'));
  const numbers = '| Option | Points |\n| --- | ---: |\n| Stay | 6 |\n| Negotiate | 9 |';
  const numericTree = context.window.renderMarkdown(numbers);
  const numericTags = [];
  visit(numericTree, node => numericTags.push(node.tagName));
  assert(numericTags.includes('svg') && numericTags.includes('table'), 'chart and source table should coexist');
  const unsupported = context.window.renderMarkdown('```mermaid\ngraph TD; A-->B\n```');
  const unsupportedTags = [];
  visit(unsupported, node => unsupportedTags.push(node.tagName));
  assert(!unsupportedTags.includes('svg'), 'unverified Mermaid diagrams must not be guessed');
  assert.equal(elements['#status'].textContent, 'Response complete. You can ask a follow-up.');
  assert.equal(transcript.scrollTop, transcript.scrollHeight);

  // A reader may receive only metadata for a while. Show an honest quiet state.
  elements['#question'].value = 'Second question';
  let releaseQuiet;
  let quietReads = 0;
  const quietFirst = new TextEncoder().encode(JSON.stringify({ event: 'preamble_end', data: {} }) + '\n');
  const quietFinal = new TextEncoder().encode(JSON.stringify(end('Second answer.', 'next-session')) + '\n');
  responseStream = { getReader() { return {
    async read() { quietReads++; if (quietReads === 1) return { done: false, value: quietFirst }; return new Promise(resolve => { releaseQuiet = resolve; }); },
    async cancel() {}, releaseLock() {}
  }; } };
  const quietPending = submit();
  for (let attempt = 0; attempt < 15 && !releaseQuiet; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert(releaseQuiet);
  for (const tick of [...timers.values()]) tick();
  assert.match(elements['#status'].textContent, /No answer text for 20 seconds/i);
  releaseQuiet({ done: false, value: quietFinal });
  await quietPending;
  assert.equal(JSON.parse(requests[1].options.body).session_id, 'returned-session');
  assert.equal(turns().length, 4);
  assert.match(turns()[3].textContent, /Second answer/);

  // Deliberate upward scroll pauses autoscroll even as token text updates; scrolling to bottom resumes it.
  transcript.scrollTop = 10;
  transcript.listeners.wheel({ deltaY: -10 });
  elements['#question'].value = 'Third question';
  responseStream = frames([{ event: 'token', data: { id: 'partial', chunk: 'Partial answer' } }]);
  const pending = submit();
  await pending;
  assert.match(elements['#error'].textContent, /closed before a usable final result/i);
  assert.match(turns()[5].textContent, /Partial answer/);
  // Submitting a new question intentionally resumes follow; test manual pausing during a later stream below.
  elements['#question'].value = 'Fourth question';
  responseStream = frames([{ event: 'token', data: { id: 'a', chunk: 'First ' } }, { event: 'token', data: { id: 'a', chunk: 'second' } }, end('First second', 'fourth-session')], 4096);
  await submit();
  assert.equal(JSON.parse(requests[3].options.body).session_id, 'next-session');
  assert.equal(turns().length, 8);
  elements['#question'].value = 'Scroll behavior';
  let heldRead;
  let readStage = 0;
  const chunkOne = new TextEncoder().encode(JSON.stringify({ event: 'token', data: { id: 'scroll-test', chunk: 'Start' } }) + '\n');
  const chunkTwo = new TextEncoder().encode(JSON.stringify({ event: 'token', data: { id: 'scroll-test', chunk: ' plus more' } }) + '\n');
  const chunkThree = new TextEncoder().encode(JSON.stringify(end('Start plus more', 'scroll-session')) + '\n');
  responseStream = { getReader() { return {
    async read() {
      readStage++;
      if (readStage === 1) return { done: false, value: chunkOne };
      if (readStage === 2 || readStage === 3) return new Promise(resolve => { heldRead = resolve; });
      return { done: true };
    }, async cancel() {}, releaseLock() {}
  }; } };
  const streaming = submit();
  for (let attempt = 0; attempt < 15 && !heldRead; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert(heldRead, 'stream should pause after first token');
  transcript.scrollTop = 0;
  transcript.listeners.wheel({ deltaY: -20 });
  heldRead({ done: false, value: chunkTwo });
  heldRead = undefined;
  for (let attempt = 0; attempt < 15 && !heldRead; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(transcript.scrollTop, 0, 'manual scroll-up is respected while text streams');
  transcript.scrollTop = transcript.scrollHeight;
  transcript.listeners.scroll();
  heldRead({ done: false, value: chunkThree });
  await streaming;
  assert.equal(transcript.scrollTop, transcript.scrollHeight, 'returning to bottom resumes following');
  elements['#new-conversation'].listeners.click();
  assert.equal(turns().length, 0);
  const openBytes = new TextEncoder().encode(JSON.stringify(end('Fresh answer.', 'fresh-session')) + '\n');
  let readCount = 0;
  let cancelled = false;
  responseStream = { getReader() { return {
    async read() { readCount++; if (readCount === 1) return { done: false, value: openBytes }; return new Promise(() => {}); },
    async cancel() { cancelled = true; }, releaseLock() {}
  }; } };
  elements['#question'].value = 'Fresh topic';
  await submit();
  assert.equal(readCount, 1, 'do not wait for a socket to close after canonical end');
  assert(cancelled, 'cancel lingering reader after canonical end');
  assert.equal(JSON.parse(requests[5].options.body).session_id, 'test-session-2');
  elements['#question'].value = 'Decision requiring input';
  const hitl = { message: 'Please clarify your priorities', fields: [{ name: 'priority', label: 'Top priority' }] };
  responseStream = frames([{ event: 'add_message', data: { id: 'hitl-1', sender: 'Machine', text: '', properties: { state: 'require_approval', hitl_request: hitl } } }], 128);
  await submit();
  assert.match(turns().at(-1).textContent, /Your input is needed/);
  assert.match(turns().at(-1).textContent, /Please clarify your priorities/);
  assert.match(elements['#status'].textContent, /Input needed/);
  assert.equal(turns().at(-1).className.includes('failed'), false);
  assert.equal(elements['#error'].hidden, true);
  elements['#question'].value = 'Another approval case';
  const pendingResult = final('Please respond', 'hitl-session');
  pendingResult.outputs[0].outputs[0].results.message.properties = { state: 'require_approval', hitl_request: hitl };
  responseStream = frames([{ event: 'end', data: { result: pendingResult } }], 128);
  await submit();
  assert.match(turns().at(-1).textContent, /Your input is needed/);
  assert.match(elements['#status'].textContent, /Input needed/);
  assert.equal(elements['#error'].hidden, true);
  console.log('Passed: NDJSON, canonical end, Markdown tables, sessions, scroll, thinking lifecycle and streamed/final HITL pending states.');
})().catch(err => { console.error(err); process.exitCode = 1; });
