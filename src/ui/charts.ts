// Hand-rolled SVG charts. Small enough that a chart library would cost more than it saves.

export function sparkline(values: number[], color: string): string {
  if (values.length < 2) return '<svg viewBox="0 0 100 22"></svg>';
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(20 - ((v - lo) / (hi - lo)) * 18).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 100 22" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

export interface Marker { day: number; label: string; }

/** Larger chart with a filled area, min/max guides and event markers. */
export function bigChart(values: number[], color: string, markers: Marker[], fmt: (v: number) => string): string {
  const W = 320, H = 130, L = 4, R = 4, T = 8, B = 16;
  if (values.length < 2) return `<svg viewBox="0 0 ${W} ${H}"></svg>`;
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  lo -= pad; hi += pad;
  const n = values.length - 1;
  const x = (i: number) => L + (i / n) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${L},${H - B} ${line} ${W - R},${H - B}`;
  const id = `g${Math.abs(Math.round(values[0]! * 1000 + values.length * 7 + color.length))}${color.replace(/[^a-z0-9]/gi, '')}`;
  const marks = markers.filter((m) => m.day <= n).map((m) =>
    `<g><line x1="${x(m.day).toFixed(1)}" x2="${x(m.day).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,0.22)" stroke-dasharray="2 3"/><circle cx="${x(m.day).toFixed(1)}" cy="${y(values[m.day] as number).toFixed(1)}" r="3" fill="#ffd166"><title>Day ${m.day}: ${m.label.replace(/[<>&"]/g, '')}</title></circle></g>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${area}" fill="url(#${id})"/>${marks}
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <text x="${L}" y="${H - 3}" font-size="9" fill="#9aa3b8">day 0</text>
    <text x="${W - R}" y="${H - 3}" font-size="9" fill="#9aa3b8" text-anchor="end">day ${n}</text>
    <text x="${W - R}" y="${T + 2}" font-size="9" fill="#9aa3b8" text-anchor="end">${fmt(hi - pad)}</text>
    <text x="${W - R}" y="${H - B - 3}" font-size="9" fill="#9aa3b8" text-anchor="end">${fmt(lo + pad)}</text>
  </svg>`;
}
