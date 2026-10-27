// Conservative Markdown renderer: DOM/text nodes only; never interpret raw HTML.
// Supports headings, paragraphs, emphasis, safe links, lists, quotes, code, and pipe tables.
(() => {
  'use strict';
  function element(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function safeUrl(raw) {
    try {
      const url = new URL(raw, document.baseURI);
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }
  function inline(parent, source) {
    const pattern = /(`+)([^`\n]+?)\1|\[([^\]]+)\]\(([^\s)]+)\)|(\*\*|__)(.+?)\5|(\*|_)(.+?)\7/g;
    let offset = 0;
    for (const match of source.matchAll(pattern)) {
      if (match.index > offset) parent.append(document.createTextNode(source.slice(offset, match.index)));
      if (match[1]) parent.append(element('code', match[2]));
      else if (match[3]) {
        const href = safeUrl(match[4]);
        if (!href) parent.append(document.createTextNode(match[3]));
        else { const link = element('a', match[3]); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link); }
      } else if (match[5]) parent.append(element('strong', match[6]));
      else if (match[7]) parent.append(element('em', match[8]));
      offset = match.index + match[0].length;
    }
    if (offset < source.length) parent.append(document.createTextNode(source.slice(offset)));
  }
  function cells(line) {
    const trimmed = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
    const parts = [];
    let part = '';
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '\\' && trimmed[i + 1] === '|') { part += '|'; i++; }
      else if (trimmed[i] === '|') { parts.push(part.trim()); part = ''; }
      else part += trimmed[i];
    }
    parts.push(part.trim());
    return parts;
  }
  function tableSeparator(line, width) {
    const parts = cells(line);
    return parts.length === width && parts.every(part => /^:?-{3,}:?$/.test(part));
  }
  function tableStart(lines, index) {
    if (index + 1 >= lines.length || !lines[index].includes('|')) return false;
    const header = cells(lines[index]);
    return header.length > 1 && tableSeparator(lines[index + 1], header.length);
  }
  function renderTable(lines, position) {
    const headers = cells(lines[position]);
    const alignments = cells(lines[position + 1]).map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '');
    const wrapper = element('div'); wrapper.className = 'table-scroll'; wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', 'Answer table');
    const table = element('table');
    const thead = element('thead');
    const top = element('tr');
    headers.forEach((cell, i) => {
      const th = element('th'); th.scope = 'col';
      if (alignments[i]) th.style.textAlign = alignments[i];
      inline(th, cell); top.append(th);
    });
    thead.append(top); table.append(thead);
    const tbody = element('tbody');
    const chartRows = [];
    let next = position + 2;
    while (next < lines.length && lines[next].trim() && lines[next].includes('|')) {
      const row = element('tr');
      const values = cells(lines[next]);
      chartRows.push(values);
      headers.forEach((_, i) => {
        const td = element('td');
        if (alignments[i]) td.style.textAlign = alignments[i];
        inline(td, values[i] || ''); row.append(td);
      });
      tbody.append(row);
      next++;
    }
    table.append(tbody); wrapper.append(table);
    const chart = typeof window.chartForTable === 'function' ? window.chartForTable(headers, chartRows) : null;
    return { wrapper, chart, next };
  }
  function renderMarkdown(source) {
    const root = document.createDocumentFragment();
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    let index = 0;
    while (index < lines.length) {
      const current = lines[index];
      if (!current.trim()) { index++; continue; }
      const fence = current.match(/^\s*(```+|~~~+)([^\s]*)\s*$/);
      if (fence) {
        const marker = fence[1][0];
        const minimum = fence[1].length;
        const code = [];
        index++;
        while (index < lines.length && !(new RegExp('^\\s*' + marker + '{' + minimum + ',}\\s*$')).test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index++;
        const pre = element('pre'); pre.append(element('code', code.join('\n'))); root.append(pre);
        continue;
      }
      if (tableStart(lines, index)) {
        const { wrapper, chart, next } = renderTable(lines, index);
        if (chart) root.append(chart);
        root.append(wrapper); index = next; continue;
      }
      const heading = current.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) { const title = element('h' + heading[1].length); inline(title, heading[2]); root.append(title); index++; continue; }
      if (/^\s{0,3}---+\s*$/.test(current)) { root.append(element('hr')); index++; continue; }
      if (/^\s{0,3}>\s?/.test(current)) {
        const quote = element('blockquote');
        const content = [];
        while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) content.push(lines[index++].replace(/^\s{0,3}>\s?/, ''));
        const p = element('p'); inline(p, content.join(' ')); quote.append(p); root.append(quote); continue;
      }
      const bullet = current.match(/^\s{0,3}([-*+] |\d+[.)] )/);
      if (bullet) {
        const ordered = /^\d/.test(bullet[1]);
        const list = element(ordered ? 'ol' : 'ul');
        const itemPattern = ordered ? /^\s{0,3}\d+[.)] (.*)$/ : /^\s{0,3}[-*+] (.*)$/;
        while (index < lines.length) {
          const item = lines[index].match(itemPattern);
          if (!item) break;
          const li = element('li'); inline(li, item[1]); list.append(li); index++;
        }
        root.append(list); continue;
      }
      const paragraph = [];
      while (index < lines.length && lines[index].trim() && !tableStart(lines, index) && !/^\s{0,3}(#{1,6}\s|[-*+] |\d+[.)] |>|```|~~~)/.test(lines[index])) paragraph.push(lines[index++]);
      if (!paragraph.length) paragraph.push(lines[index++]);
      const p = element('p'); inline(p, paragraph.join(' ')); root.append(p);
    }
    return root;
  }
  window.renderMarkdown = renderMarkdown;
})();
