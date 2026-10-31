// Split It: chart drawing helpers and icons. Pure functions that return SVG markup.
(function (global) {
'use strict';

const S = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const CATEGORY_ICONS = {
  food: S('<path d="M7 3v7.5M4.5 3v4.8a2.5 2.5 0 0 0 5 0V3M7 10.5V21M17.5 21V3c-2 1.2-3 3.6-3 7 0 1.6.9 2.6 3 2.6"/>'),
  groceries: S('<path d="M4.5 8.5h15l-1.3 10.3a2 2 0 0 1-2 1.7H7.8a2 2 0 0 1-2-1.7z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>'),
  rent: S('<path d="M3.5 10.5L12 4l8.5 6.5"/><path d="M6 9v11h12V9"/><path d="M10 20v-5.5h4V20"/>'),
  transport: S('<path d="M5 12.5l1.6-4.6A2 2 0 0 1 8.5 6.5h7a2 2 0 0 1 1.9 1.4l1.6 4.6"/><rect x="3.5" y="12.5" width="17" height="5" rx="1.6"/><path d="M6.5 17.5v2M17.5 17.5v2M7.5 15h.01M16.5 15h.01"/>'),
  accommodation: S('<path d="M3 19V6M3 15h18v4M21 15v-2.5A3.5 3.5 0 0 0 17.5 9H11v6"/><circle cx="7" cy="11.5" r="2"/>'),
  activities: S('<path d="M3.5 9V7a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v2a3 3 0 0 0 0 6v2a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-2a3 3 0 0 0 0-6z"/><path d="M14.5 6.5v1.5M14.5 11.2v1.6M14.5 16v1.5"/>'),
  bills: S('<path d="M13 2.8L5.5 13.2h5.8L10.6 21.2l7.9-10.4h-5.8z"/>'),
  other: S('<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>'),
  payment: S('<path d="M4 8h13.5M14 4.5L17.5 8 14 11.5"/><path d="M20 16H6.5M10 12.5L6.5 16l3.5 3.5"/>'),
};

const ICONS = {
  edit: S('<path d="M4 20l1-4L15.5 5.5a2.1 2.1 0 0 1 3 3L8 19z"/>'),
  trash: S('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7"/>'),
  arrow: S('<path d="M5 12h13M13.5 7.5L18 12l-4.5 4.5"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  people: S('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.8 14.8c1.7.6 2.9 2.2 3.2 4.7"/>'),
  receipt: S('<path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  sparkle: S('<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>'),
};

const TAU = Math.PI * 2;
function pt(cx, cy, r, a) { return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }
function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = pt(cx, cy, r, a0);
  const [x1, y1] = pt(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (a1 - a0 < 1e-4) return `M${x0.toFixed(2)} ${y0.toFixed(2)}L${(x0 + 0.01).toFixed(2)} ${y0.toFixed(2)}`;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Donut with rounded caps and even gaps. segments: [{key, value, color}]. Returns SVG markup.
 *  Each arc is trimmed by the cap radius at both ends so the round caps never overlap. */
function donut(segments, { size = 220, thickness = 24, gap = 4 } = {}) {
  const cx = size / 2, cy = size / 2, r = (size - thickness) / 2 - 6;
  const total = segments.reduce((a, s) => a + s.value, 0);
  const track = `<circle class="sx-donut-track" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${thickness}"/>`;
  if (!total) return `<svg viewBox="0 0 ${size} ${size}" class="sx-donut-svg">${track}</svg>`;
  const trim = (thickness / 2 + gap / 2) / r; // radians removed from each end
  // Give every slice at least room for its round cap plus a gap, taking the space from the big ones.
  const minSpan = 2 * trim + 0.02;
  let spans = segments.map((s) => (s.value / total) * TAU);
  if (segments.length > 1) {
    for (let k = 0; k < 4; k++) {
      const small = spans.map((x) => x < minSpan);
      const fixed = small.filter(Boolean).length * minSpan;
      const free = spans.reduce((a, x, i) => a + (small[i] ? 0 : x), 0);
      if (!fixed || !free) break;
      spans = spans.map((x, i) => (small[i] ? minSpan : (x * (TAU - fixed)) / free));
    }
  }
  let a = 0;
  const arcs = segments.map((s, i) => {
    const a0 = a, a1 = a + spans[i];
    a = a1;
    let s0 = a0 + trim, s1 = a1 - trim;
    if (s1 < s0) { const m = (a0 + a1) / 2; s0 = s1 = m; }
    const d = segments.length === 1
      ? `M${cx} ${cy - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`
      : arcPath(cx, cy, r, s0, s1);
    return `<path class="sx-seg" data-key="${s.key}" data-i="${i}" d="${d}" stroke="${s.color}" stroke-width="${thickness}" fill="none" stroke-linecap="round"><title>${String(s.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title></path>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="sx-donut-svg">${arcs}</svg>`;
}

global.SplitCharts = { donut, CATEGORY_ICONS, ICONS };
})(typeof window !== 'undefined' ? window : globalThis);
