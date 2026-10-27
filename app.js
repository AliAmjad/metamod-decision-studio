(() => {
  'use strict';
  const form = document.querySelector('#question-form');
  const question = document.querySelector('#question');
  const submit = document.querySelector('#submit-button');
  const status = document.querySelector('#status');
  const transcript = document.querySelector('#conversation');
  const emptyState = document.querySelector('#empty-state');
  const error = document.querySelector('#error');
  const stop = document.querySelector('#stop-button');
  const newConversation = document.querySelector('#new-conversation');
  const contextLabel = document.querySelector('#composer-context');
  const config = window.METAMOD_CONFIG || {};
  const endpoint = config.proxyEndpoint;
  let sessionId = makeSessionId();
  let controller = null;
  let autoFollow = true;
  let lastProgrammaticScroll = 0;
  const QUIET_MS = 20000;

  function makeSessionId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }
  function setStatus(text) { status.textContent = text; }
  function setError(text) { error.hidden = false; error.textContent = text; setStatus(''); }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function nearBottom() { return transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= 64; }
  function scrollToLatest() {
    if (!autoFollow) return;
    transcript.scrollTop = transcript.scrollHeight;
    lastProgrammaticScroll = transcript.scrollTop;
  }
  // Keep following while near the bottom. An intentional upward scroll pauses following;
  // returning to the bottom resumes it. Browser-generated scroll events from rendering
  // are not mistaken for user intent.
  transcript.addEventListener('wheel', event => { if (event.deltaY < 0) autoFollow = false; else if (nearBottom()) autoFollow = true; }, { passive: true });
  transcript.addEventListener('touchstart', () => { transcript._touchStart = transcript.scrollTop; }, { passive: true });
  transcript.addEventListener('touchmove', () => {
    if (transcript.scrollTop < (transcript._touchStart ?? transcript.scrollTop) - 2) autoFollow = false;
    else if (nearBottom()) autoFollow = true;
  }, { passive: true });
  transcript.addEventListener('scroll', () => {
    if (nearBottom()) autoFollow = true;
    else if (transcript.scrollTop < lastProgrammaticScroll - 2) autoFollow = false;
  }, { passive: true });
  transcript.addEventListener('keydown', event => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) autoFollow = false;
    if (['End'].includes(event.key)) autoFollow = true;
  });

  function addTurn(role, text) {
    emptyState.hidden = true;
    const article = element('article', `turn turn-${role}`);
    const head = element('div', 'turn-head');
    head.append(element('span', 'role', role === 'user' ? 'YOU' : 'AGENT'));
    const body = element('div', role === 'user' ? 'user-text' : 'markdown');
    if (role === 'user') body.textContent = text;
    article.append(head, body);
    const previousScroll = transcript.scrollTop;
    const shouldFollow = autoFollow && nearBottom();
    transcript.append(article);
    if (shouldFollow) scrollToLatest();
    else transcript.scrollTop = previousScroll;
    return { article, body };
  }
  function addThinking(turn) {
    const indicator = element('div', 'thinking-indicator');
    indicator.setAttribute('aria-hidden', 'true');
    indicator.append(element('span', 'thinking-dots'), element('span', 'thinking-label', 'Thinking'));
    turn.article.append(indicator);
    turn.thinking = indicator;
    scrollToLatest();
  }
  function stopThinking(turn) {
    turn.thinking?.remove();
    turn.thinking = null;
  }
  function setAnswer(turn, text, isFinal = false) {
    if (!text || !text.trim()) return;
    const previousScroll = transcript.scrollTop;
    const shouldFollow = autoFollow && nearBottom();
    if (!shouldFollow) autoFollow = false;
    turn.body.replaceChildren(window.renderMarkdown(text));
    turn.text = text;
    if (isFinal) {
      turn.article.classList?.add('complete');
      if (!turn.copy) {
        turn.copy = element('button', 'copy-button', 'Copy answer');
        turn.copy.type = 'button';
        turn.copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(turn.text); turn.copy.textContent = 'Copied'; setTimeout(() => { turn.copy.textContent = 'Copy answer'; }, 1800); }
          catch { turn.copy.textContent = 'Copy unavailable'; }
        });
        turn.article.append(turn.copy);
      }
    }
    if (shouldFollow) scrollToLatest();
    else transcript.scrollTop = previousScroll;
  }
  function hitlRequest(message) {
    return message?.properties?.hitl_request ?? message?.data?.properties?.hitl_request ?? null;
  }
  function showHitl(turn, request) {
    stopThinking(turn);
    const panel = element('section', 'hitl-panel');
    panel.setAttribute('aria-label', 'Input needed from you');
    panel.append(element('strong', '', 'Your input is needed'));
    const detail = [request?.message, request?.prompt, request?.description, request?.text]
      .find(value => typeof value === 'string' && value.trim());
    if (detail) panel.append(element('p', '', detail));
    panel.append(element('p', 'hitl-guidance', 'This run is waiting for human input. Its response fields and submission endpoint have not been supplied, so this page cannot safely submit the form yet.'));
    if (request && typeof request === 'object' && !detail) panel.append(element('p', 'hitl-guidance', 'Ask the agent owner for a redacted HITL request example and the documented resume endpoint.'));
    turn.article.append(panel);
    turn.hitl = panel;
    scrollToLatest();
    setStatus('Input needed from you. This run is not complete.');
  }
  function isMachine(value) {
    const sender = value?.sender ?? value?.data?.sender;
    return typeof sender === 'string' && sender.toLowerCase() === 'machine';
  }
  function messageText(message) {
    const options = [message?.data?.text, message?.text, message?.message];
    return options.find(value => typeof value === 'string' && value.trim()) || '';
  }
  function canonicalResult(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.outputs)) throw new Error('The stream ended without a usable final response.');
    const entries = body.outputs.flatMap(group => Array.isArray(group?.outputs) ? group.outputs : []);
    if (!entries.length) throw new Error('The final response contained no output messages.');
    const pending = entries.map(entry => entry?.results?.message).find(message =>
      message && (hitlRequest(message) || message?.properties?.require_approval || message?.properties?.state === 'require_approval' || message?.data?.properties?.state === 'require_approval'));
    if (pending) return { pending: true, request: hitlRequest(pending), sessionId: typeof body.session_id === 'string' ? body.session_id : '' };
    const texts = [];
    const seen = new Set();
    for (const entry of entries) {
      const message = entry?.results?.message;
      if (message?.error === true || message?.data?.error === true || entry?.error === true) throw new Error('The agent reported an error instead of an answer.');
      const state = message?.properties?.state ?? message?.data?.properties?.state;
      if (state && state !== 'complete') throw new Error(`The agent did not complete its response (state: ${state}). An approval or additional action may be required.`);
      const candidates = [
        message && isMachine(message) ? messageText(message) : '',
        ...((Array.isArray(entry?.messages) ? entry.messages : []).filter(isMachine).map(item => item.message)),
        entry?.outputs?.message?.message,
        entry?.artifacts?.sender === 'Machine' ? entry.artifacts.message : ''
      ];
      const text = candidates.find(value => typeof value === 'string' && value.trim());
      if (text && !seen.has(text)) { texts.push(text); seen.add(text); }
    }
    if (!texts.length) throw new Error('The final response contained no Machine text answer.');
    return { text: texts.join('\n\n'), sessionId: typeof body.session_id === 'string' ? body.session_id : '' };
  }

  // NDJSON: lines can be split across reads, including in the middle of a UTF-8 character.
  async function consumeStream(stream, onEvent, signal, isPending = () => false) {
    if (!stream || typeof stream.getReader !== 'function') throw new Error('The browser received no readable event stream.');
    const reader = stream.getReader();
    let reachedEnd = false;
    const decoder = new TextDecoder();
    let buffer = '';
    function processLine(line) {
      const value = line.trim();
      if (!value) return;
      let frame;
      try { frame = JSON.parse(value); } catch { throw new Error('The stream contained a malformed JSON event.'); }
      if (!frame || typeof frame.event !== 'string') throw new Error('The stream contained an event without a valid event name.');
      onEvent(frame);
      if (frame.event === 'end') reachedEnd = true;
    }
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        if (signal.aborted) throw new DOMException('Interrupted', 'AbortError');
        const { value, done } = await reader.read();
        if (signal.aborted) throw new DOMException('Interrupted', 'AbortError');
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let breakAt;
        while ((breakAt = buffer.indexOf('\n')) >= 0) {
          processLine(buffer.slice(0, breakAt));
          buffer = buffer.slice(breakAt + 1);
          if (reachedEnd || isPending()) break;
        }
        if (reachedEnd || isPending()) break;
        if (buffer.length > 4_000_000) throw new Error('The stream event exceeded the supported size.');
        if (done) break;
      }
      if (!reachedEnd && !isPending() && buffer.trim()) processLine(buffer);
    } finally {
      signal.removeEventListener('abort', cancel);
      if (reachedEnd || isPending() || signal.aborted) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  function startRun(turn) {
    const messages = new Map();
    let ended = false;
    let final = null;
    let anonymous = 0;
    let receivedContent = false;
    function updateProvisional() {
      if (ended) return;
      const text = [...messages.values()].filter(item => item.text && !item.error).map(item => item.text).join('\n\n');
      if (text) { receivedContent = true; setAnswer(turn, text); setStatus('Receiving answer…'); }
    }
    function receive(frame) {
      if (ended) return;
      const data = frame.data;
      if (frame.event === 'preamble_end') return;
      if (frame.event === 'token') {
        const token = data?.data && typeof data.data === 'object' ? data.data : data;
        if (!token || typeof token.chunk !== 'string' || !token.chunk) return;
        const id = token.id != null ? String(token.id) : data?.id != null ? String(data.id) : 'anonymous-' + (++anonymous);
        const item = messages.get(id) || { text: '', error: false, complete: false };
        if (!item.complete) item.text += token.chunk;
        messages.set(id, item);
        updateProvisional();
        return;
      }
      if (frame.event === 'add_message') {
        const message = data?.data && typeof data.data === 'object' ? data.data : data;
        if (!message || !isMachine(message)) return;
        const id = String(message.id ?? data?.id ?? 'anonymous-' + (++anonymous));
        const previous = messages.get(id) || { text: '', error: false, complete: false };
        const state = message?.properties?.state ?? data?.properties?.state;
        const text = messageText(message);
        previous.error = message.error === true || data?.error === true;
        if (previous.error) { messages.set(id, previous); throw new Error('The agent reported an error in its streamed message.'); }
        if (state === 'require_approval' || message?.properties?.require_approval || hitlRequest(message)) {
          if (!turn.hitl) showHitl(turn, hitlRequest(message));
          return;
        }
        if (state === 'complete') { if (text) previous.text = text; previous.complete = true; }
        else if (!previous.complete && text && text.length > previous.text.length && text.startsWith(previous.text)) previous.text = text;
        else if (!previous.complete && text && !previous.text) previous.text = text;
        messages.set(id, previous);
        updateProvisional();
        return;
      }
      if (frame.event === 'end') {
        // Prefer canonical end.data.result, including when no provisional messages arrived.
        final = canonicalResult(data?.result);
        ended = true;
        if (final.pending) {
          if (!turn.hitl) showHitl(turn, final.request);
          if (final.sessionId) sessionId = final.sessionId;
          return;
        }
        stopThinking(turn);
        turn.hitl?.remove();
        turn.hitl = null;
        setAnswer(turn, final.text, true);
        if (final.sessionId) sessionId = final.sessionId;
        contextLabel.textContent = '· Ask a follow-up';
        setStatus('Response complete. You can ask a follow-up.');
      }
    }
    return { receive, hasContent: () => receivedContent, finished: () => ended, pending: () => Boolean(turn.hitl), result() { if (turn.hitl) return { pending: true }; if (!ended || !final) throw new Error('The stream closed before a usable final result arrived. Partial text may be shown above.'); return final; } };
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (controller) return;
    const prompt = question.value.trim();
    if (!prompt) { question.setCustomValidity('Please enter a question.'); question.reportValidity(); return; }
    if (!endpoint) { setError('The run endpoint is not configured.'); return; }
    error.hidden = true;
    autoFollow = true;
    addTurn('user', prompt);
    const agentTurn = addTurn('agent');
    addThinking(agentTurn);
    question.value = '';
    controller = new AbortController();
    const activeController = controller;
    submit.disabled = true;
    stop.hidden = false;
    newConversation.disabled = true;
    submit.firstChild.textContent = 'Thinking… ';
    setStatus('Waiting for the agent…');
    let quietTimer;
    let streamFinished = false;
    const quiet = () => {
      if (!streamFinished && !activeController.signal.aborted) setStatus(agentTurn.text ? 'No new answer text for 20 seconds. Waiting for the final result… You can stop the response.' : 'No answer text for 20 seconds. Still waiting for the agent… You can stop the response.');
    };
    const resetQuiet = () => { clearTimeout(quietTimer); quietTimer = setTimeout(quiet, QUIET_MS); };
    resetQuiet();
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output_type: 'chat', input_type: 'chat', input_value: prompt, session_id: sessionId }),
        signal: activeController.signal
      });
      if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}). Check the site's Netlify Function configuration and access policy.`);
      const run = startRun(agentTurn);
      await consumeStream(response.body, frame => {
        resetQuiet();
        run.receive(frame);
        if (!run.finished() && !run.pending() && !run.hasContent()) setStatus('Agent is working… Waiting for answer text.');
      }, activeController.signal, () => run.pending());
      run.result();
      streamFinished = true;
    } catch (problem) {
      stopThinking(agentTurn);
      if (!agentTurn.text && !agentTurn.hitl) agentTurn.body.textContent = 'No answer received.';
      agentTurn.article.classList?.add('failed');
      if (activeController.signal.aborted) setError('Response interrupted. Any partial text above is not a completed answer.');
      else setError(problem instanceof TypeError ? 'The browser could not reach the API. Check connectivity, CORS permissions and the endpoint.' : problem.message);
    } finally {
      stopThinking(agentTurn);
      streamFinished = true;
      clearTimeout(quietTimer);
      controller = null;
      submit.disabled = false;
      stop.hidden = true;
      newConversation.disabled = false;
      submit.firstChild.textContent = 'Send question ';
      question.focus();
    }
  });
  stop.addEventListener('click', () => controller?.abort());
  newConversation.addEventListener('click', () => {
    if (controller) return;
    sessionId = makeSessionId();
    autoFollow = true;
    transcript.replaceChildren(emptyState);
    emptyState.hidden = false;
    error.hidden = true;
    question.value = '';
    contextLabel.textContent = '· Start a conversation';
    setStatus('New conversation started.');
    question.focus();
  });
  question.addEventListener('input', () => question.setCustomValidity(''));
  question.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
    }
  });
})();
