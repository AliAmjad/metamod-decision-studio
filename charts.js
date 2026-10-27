// Visualizes numeric Markdown tables; source table remains accessible as the data view.
// This does not decode undocumented Metamod file/artifact payloads.
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attributes = {}) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }
  function numeric(value) {
    const text = value.trim().replace(/\*\*|__|`/g, '');
    // Only unambiguous signed numbers, optional currency and %; never fabricate values.
    const match = text.match(/^([$€£])?\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(%)?$/);
    return match ? Number(match[2].replaceAll(',', '')) : null;
  }
  function chartForTable(headers, rows) {
    if (headers.length < 2 || rows.length < 2 || rows.length > 24) return null;
    const labels = rows.map(row => (row[0] || '').trim().replace(/\*\*|__|`/g, ''));
    if (labels.some(label => !label || label.length > 60)) return null;
    // First text column plus 1-3 entirely numeric series. Mixed units are not inferred.
    const columns = [];
    for (let col = 1; col < Math.min(headers.length, 4); col++) {
      const values = rows.map(row => numeric(row[col] || ''));
      if (values.some(value => value === null || !Number.isFinite(value))) return null;
      columns.push({ label: headers[col].trim(), values });
    }
    if (!columns.length) return null;
    const figure = document.createElement('figure');
    figure.className = 'data-chart';
    const title = document.createElement('figcaption');
    title.textContent = `Visual comparison · ${columns.map(column => column.label).join(' / ')}`;
    figure.append(title);
    const chart = svg('svg', { viewBox: `0 0 720 ${Math.max(170, rows.length * (columns.length * 20 + 24) + 58)}`, role: 'img', 'aria-label': `Bar chart comparing ${labels.join(', ')}. Exact values in the table below.`, preserveAspectRatio: 'xMinYMin meet' });
    const width = 410;
    const left = 210;
    const values = columns.flatMap(column => column.values);
    const lower = Math.min(0, ...values);
    const upper = Math.max(0, ...values);
    const span = upper - lower || 1;
    const zero = left + ((0 - lower) / span) * width;
    const colors = ['#397460', '#d28c55', '#557795'];
    const rowHeight = columns.length * 20 + 24;
    rows.forEach((row, rowIndex) => {
      const y = 30 + rowIndex * rowHeight;
      const labelNode = svg('text', { x: 8, y: y + 16, class: 'chart-label' });
      labelNode.textContent = labels[rowIndex].length > 28 ? labels[rowIndex].slice(0, 27) + '…' : labels[rowIndex];
      chart.append(labelNode);
      columns.forEach((column, colIndex) => {
        const value = column.values[rowIndex];
        const endpoint = left + ((value - lower) / span) * width;
        const bar = svg('rect', { x: Math.min(zero, endpoint), y: y + colIndex * 20, width: Math.max(1, Math.abs(endpoint - zero)), height: 15, rx: 2, fill: colors[colIndex] });
        const tooltip = svg('title');
        tooltip.textContent = `${labels[rowIndex]} · ${column.label}: ${row[colIndex + 1]}`;
        bar.append(tooltip);
        chart.append(bar);
        const valueLabel = svg('text', { x: Math.min(705, Math.max(left + 4, endpoint + (value < 0 ? -40 : 5))), y: y + colIndex * 20 + 12, class: 'chart-value' });
        valueLabel.textContent = row[colIndex + 1];
        chart.append(valueLabel);
      });
    });
    chart.append(svg('line', { x1: zero, x2: zero, y1: 20, y2: 30 + rows.length * rowHeight, stroke: '#b8c8bb', 'stroke-width': 1 }));
    figure.append(chart);
    const note = document.createElement('p');
    note.className = 'chart-note';
    note.textContent = 'Values provided by the agent; the table below contains the exact data.';
    figure.append(note);
    return figure;
  }
  window.chartForTable = chartForTable;
})();
