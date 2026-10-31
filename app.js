// Split It: the app UI. Money maths lives in logic.js, chart geometry in charts.js.
(function () {
'use strict';
const L = window.SplitLogic;
const C = window.SplitCharts;
const X = window.SplitExample;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = ZL.esc;
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const todayISO = () => X.isoDaysAgo(0);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (m, cur, o) => L.formatMoney(m, cur, o);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

const EMOJIS = ['🏝️', '🏠', '🍽️', '✈️', '🎉', '🏕️', '🚗', '⛷️', '🍻', '🎓', '💼', '🛒'];
const COLOR_LABELS = { green: 'Green', blue: 'Blue', indigo: 'Indigo', purple: 'Purple', pink: 'Pink', orange: 'Orange', teal: 'Teal', graphite: 'Graphite' };
const MODE_HINTS = {
  equal: 'Everyone ticked pays the same. Leftover cents go to the first people in the list.',
  exact: 'Type what each person owes. The amounts must add up to the total.',
  shares: 'Give people more shares to pay more. 2 shares pays twice as much as 1.',
  items: 'Add each line from the receipt. Tax and tip are shared in proportion to what each person had.',
};

/* ---------------- State ---------------- */
function blankGroup(name) {
  return { id: uid(), name: name || 'My group', emoji: '', color: 'green', currency: 'AUD', people: [], expenses: [], created: Date.now() };
}
function revive(g) {
  const c = L.sanitizeGroup(g);
  return c ? Object.assign(c, { id: typeof g.id === 'string' ? g.id : uid(), isExample: !!g.isExample, created: g.created || 0 }) : null;
}
function migrateV1() {
  try {
    const raw = JSON.parse(localStorage.getItem('split-it:v1') || 'null');
    if (!raw || !Array.isArray(raw.groups)) return null;
    const groups = raw.groups.map((g) => {
      g.expenses = (g.expenses || []).map((e) => Object.assign({ date: todayISO(), category: L.guessCategory(e.desc) || 'other' }, e));
      return revive(g);
    }).filter(Boolean);
    if (!groups.length) return null;
    return { version: 2, activeId: groups.some((g) => g.id === raw.activeId) ? raw.activeId : groups[0].id, groups };
  } catch (e) { return null; }
}
function load() {
  const s = ZL.store.get('state', null);
  if (s && Array.isArray(s.groups)) {
    const groups = s.groups.map(revive).filter(Boolean);
    if (groups.length) return { version: 2, activeId: groups.some((g) => g.id === s.activeId) ? s.activeId : groups[0].id, groups };
  }
  const v1 = migrateV1();
  if (v1) return v1;
  const g = blankGroup();
  return { version: 2, activeId: g.id, groups: [g] };
}
let state = load();
const ui = Object.assign({ view: 'overview', cur: null }, ZL.store.get('ui', {}));
ui.filters = { q: '', person: '', category: '' };
ui.donutKey = null;
ui.donutPinned = false;

const group = () => state.groups.find((g) => g.id === state.activeId) || state.groups[0];
const personName = (id, g = group()) => g.people.find((p) => p.id === id)?.name ?? 'Someone';
const personIndex = (id, g = group()) => Math.max(0, g.people.findIndex((p) => p.id === id));
const order = (g = group()) => g.people.map((p) => p.id);
const realExpenses = (g = group()) => g.expenses.filter((e) => e.kind !== 'payment');

let saveTimer;
function save() {
  const ok = ZL.store.set('state', state);
  const el = $('#status-saved');
  el.classList.toggle('is-bad', !ok);
  el.querySelector('span').textContent = ok ? 'Saved' : 'Not saved: storage is off';
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => el.classList.remove('is-flash'), 1200);
  return ok;
}
function saveUi() { ZL.store.set('ui', { view: ui.view === 'editor' ? 'overview' : ui.view, cur: ui.cur }); }

/* ---------------- Small renderers ---------------- */
function initials(name) {
  const w = String(name).trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}
function avatar(id, g = group(), cls = '') {
  const i = personIndex(id, g);
  return `<span class="sx-av ${cls}" style="--h:var(--p${(i % 6) + 1})" aria-hidden="true">${esc(initials(personName(id, g)))}</span>`;
}
function badgeInner(g) { return g.emoji ? esc(g.emoji) : esc((g.name.trim()[0] || 'G').toUpperCase()); }
function paintBadge(el, g) { el.dataset.color = g.color || 'green'; el.classList.toggle('has-emoji', !!g.emoji); el.innerHTML = badgeInner(g); }
function catTile(cat) {
  if (cat === 'payment') return `<span class="sx-cat-tile is-pay" aria-hidden="true">${C.CATEGORY_ICONS.payment}</span>`;
  return `<span class="sx-cat-tile" style="--c:var(--cat-${cat})" aria-hidden="true">${C.CATEGORY_ICONS[cat] || C.CATEGORY_ICONS.other}</span>`;
}
function shortDate(iso, withWeekday = true) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const o = { day: 'numeric', month: 'short' };
  if (withWeekday) o.weekday = 'short';
  if (y !== new Date().getFullYear()) o.year = 'numeric';
  return new Intl.DateTimeFormat('en-AU', o).format(dt).replace(',', '');
}
function dayLabel(iso) {
  if (iso === todayISO()) return 'Today';
  if (iso === X.isoDaysAgo(1)) return 'Yesterday';
  return shortDate(iso);
}
function activeCurrency(g = group()) {
  const used = L.currenciesUsed(g);
  if (!used.includes(ui.cur)) ui.cur = used[0];
  return ui.cur;
}
function animateNumber(el, to, cur) {
  const from = Number(el.dataset.v || 0);
  const sameCur = el.dataset.cur === cur;
  el.dataset.v = to;
  el.dataset.cur = cur;
  cancelAnimationFrame(el._raf);
  if (reduced() || from === to || !sameCur || !el.isConnected) { el.textContent = fmt(to, cur); return; }
  const t0 = performance.now(), dur = 520;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e), cur);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/** Replace markup only when it changed, so live previews never swap a button out from under a click. */
function setHTML(el, html) { if (el._html !== html) { el._html = html; el.innerHTML = html; } }

/* ---------------- App bar and group menu ---------------- */
function renderAppbar() {
  const g = group();
  paintBadge($('#group-badge'), g);
  $('#group-name').textContent = g.name;
  const n = realExpenses(g).length;
  $('#status-counts').textContent = `${plural(g.people.length, 'person', 'people')}, ${plural(n, 'expense')}`;
  $('#activity-count').textContent = g.expenses.length || '';
  $('#people-count').textContent = g.people.length || '';
  $('#group-list').innerHTML = state.groups.map((x) => {
    const cur = L.currenciesUsed(x)[0];
    const tot = L.computeBalances(x, cur).total;
    const on = x.id === g.id;
    return `<li><button type="button" class="sx-menu-item" data-group="${esc(x.id)}" ${on ? 'aria-current="true"' : ''}>
      <span class="sx-gbadge" data-color="${esc(x.color)}" aria-hidden="true">${badgeInner(x)}</span>
      <span class="sx-mi-text"><b>${esc(x.name)}</b><small>${plural(x.people.length, 'person', 'people')}, ${tot ? fmt(tot, cur) : 'nothing spent yet'}</small></span>
      ${on ? `<span class="sx-mi-check">${C.ICONS.check}</span>` : ''}</button></li>`;
  }).join('');
}
function openMenu(open) {
  const m = $('#group-menu'), b = $('#group-btn');
  m.hidden = !open;
  b.setAttribute('aria-expanded', String(open));
  if (open) (m.querySelector('[aria-current]') || m.querySelector('button')).focus();
}
$('#group-btn').addEventListener('click', (e) => { e.stopPropagation(); openMenu($('#group-menu').hidden); });
document.addEventListener('click', (e) => { if (!$('#group-menu').hidden && !$('#group-menu').contains(e.target)) openMenu(false); });
$('#group-menu').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { openMenu(false); $('#group-btn').focus(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const items = $$('#group-menu button');
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    e.preventDefault();
  }
});
$('#group-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-group]');
  if (!b) return;
  switchGroup(b.dataset.group);
  openMenu(false);
});
function switchGroup(id) {
  if (id === state.activeId) return;
  state.activeId = id;
  ui.cur = null;
  ui.filters = { q: '', person: '', category: '' };
  if (ui.view === 'editor') closeEditor(true);
  save();
  render();
  ZL.toast(`Switched to ${group().name}`, { type: 'info' });
}
$('#new-group-btn').addEventListener('click', () => { openMenu(false); openGroupDialog(null); });
$('#edit-group-btn').addEventListener('click', () => { openMenu(false); openGroupDialog(group()); });
$('#gc-edit').addEventListener('click', () => openGroupDialog(group()));

/* ---------------- Tabs ---------------- */
const VIEWS = ['overview', 'activity', 'people'];
function setView(v, { focus = false } = {}) {
  if (ui.view === 'editor' && v !== 'editor') closeEditor(true);
  ui.view = v;
  for (const name of VIEWS) {
    const tab = $('#tab-' + name);
    const on = name === v;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $('#view-' + name).hidden = !on;
  }
  if (focus) $('#tab-' + v).focus();
  saveUi();
  renderView();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
$('#tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const i = VIEWS.indexOf(ui.view);
  setView(VIEWS[(i + (e.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length], { focus: true });
  e.preventDefault();
});
function renderCurrencySwitch() {
  const used = L.currenciesUsed(group());
  const box = $('#cur-switch');
  box.hidden = used.length < 2 || ui.view === 'people';
  const cur = activeCurrency();
  $('#cur-seg').innerHTML = used.map((c) => `<button type="button" data-cur="${c}" aria-pressed="${c === cur}">${c}</button>`).join('');
}
$('#cur-seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cur]');
  if (!b) return;
  ui.cur = b.dataset.cur;
  saveUi();
  render();
});

/* ---------------- Overview ---------------- */
function renderStart(g) {
  const people = g.people.length, spent = realExpenses(g).length;
  const card = $('#start-card');
  card.hidden = people >= 2 && spent > 0;
  if (card.hidden) return;
  const steps = [
    [people >= 2, people >= 2 ? `${plural(people, 'person', 'people')} added` : people === 1 ? 'Add one more person' : 'Add at least two people'],
    [spent > 0, 'Log the first thing someone paid for'],
    [false, 'Settle up with the fewest payments'],
  ];
  $('#start-steps').innerHTML = steps.map(([done, text], i) =>
    `<li class="${done ? 'is-done' : ''}"><span class="sx-step-dot" aria-hidden="true">${done ? C.ICONS.check : i + 1}</span><span>${esc(text)}${done ? '<span class="sr-only"> (done)</span>' : ''}</span></li>`).join('');
  $('#start-actions').innerHTML = (people < 2
    ? '<button type="button" class="zl-btn zl-btn-primary" data-start="people">Add people</button>'
    : '<button type="button" class="zl-btn zl-btn-primary" data-start="expense">Add expense</button>') +
    '<button type="button" class="zl-btn zl-btn-secondary" data-start="example">Load example</button>';
}
$('#start-actions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-start]');
  if (!b) return;
  if (b.dataset.start === 'people') { setView('people'); $('#person-name').focus(); }
  if (b.dataset.start === 'expense') openEditor(null);
  if (b.dataset.start === 'example') loadExample();
});

function renderOverview() {
  const g = group();
  const cur = activeCurrency(g);
  const data = L.computeBalances(g, cur);
  renderStart(g);

  // Total
  animateNumber($('#total-num'), data.total, cur);
  const spent = g.expenses.filter((e) => e.kind !== 'payment' && e.currency === cur);
  if (!spent.length) {
    $('#total-meta').textContent = g.people.length ? 'No expenses yet. Add the first one to see balances.' : 'Add people, then log what they paid.';
    $('#total-side').innerHTML = '';
  } else {
    const dates = spent.map((e) => e.date).sort();
    const range = dates[0] === dates[dates.length - 1] ? `on ${shortDate(dates[0], false)}` : `from ${shortDate(dates[0], false)} to ${shortDate(dates[dates.length - 1], false)}`;
    $('#total-meta').textContent = `${plural(spent.length, 'expense')} ${range}`;
    const biggest = spent.reduce((a, b) => (b.amount > a.amount ? b : a));
    $('#total-side').innerHTML =
      `<div class="zl-stat"><b class="num">${fmt(Math.round(data.total / Math.max(1, g.people.length)), cur)}</b><span>Average per person</span></div>
       <div class="zl-stat" title="${esc(biggest.desc)}"><b class="num">${fmt(biggest.amount, cur)}</b><span>Biggest expense</span></div>`;
  }

  // Spent per person
  const maxShare = Math.max(1, ...g.people.map((p) => Math.max(data.share[p.id], data.paid[p.id])));
  $('#per-person').innerHTML = g.people.length ? g.people.map((p) => {
    const s = data.share[p.id], pd = data.paid[p.id];
    return `<li>${avatar(p.id, g)}<span class="sx-pp-name">${esc(p.name)}</span>
      <span class="sx-pp-bar" aria-hidden="true"><em style="width:${(pd / maxShare) * 100}%"></em><i style="width:${(s / maxShare) * 100}%"></i></span>
      <span class="sx-pp-amt"><b class="num">${fmt(s, cur)}</b><small class="num">paid ${fmt(pd, cur)}</small></span></li>`;
  }).join('') : `<li class="sx-inline-empty"><span>No people yet.</span><button type="button" class="zl-btn zl-btn-ghost zl-btn-sm" data-goto="people">Add people</button></li>`;

  renderDonut(data, cur);
  renderBalances(g, data, cur);
  renderSettle(g, data, cur);
}
$('#view-overview').addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]');
  if (b) { setView(b.dataset.goto); if (b.dataset.goto === 'people') $('#person-name').focus(); }
});

/* Donut */
let donutData = null;
function renderDonut(data, cur) {
  const segs = L.CATEGORIES.map((c) => ({ key: c.id, label: c.label, value: data.byCategory[c.id] || 0, color: `var(--cat-${c.id})`, title: `${c.label}: ${fmt(data.byCategory[c.id] || 0, cur)}` }))
    .filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  donutData = { segs, total: data.total, cur };
  const host = $('#donut');
  host.innerHTML = C.donut(segs, { size: 220, thickness: 22, gap: 6 }) +
    `<div class="sx-donut-center" id="donut-center" aria-live="polite"></div>`;
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', segs.length ? 'Spending by category: ' + segs.map((s) => `${s.label} ${fmt(s.value, cur)}`).join(', ') : 'No spending yet');
  $('#legend').innerHTML = segs.length ? segs.map((s) => {
    const pct = Math.round((s.value / data.total) * 1000) / 10;
    return `<li><button type="button" class="sx-leg" data-key="${s.key}" aria-pressed="false">
      <span class="sx-leg-dot" style="--c:${s.color}">${C.CATEGORY_ICONS[s.key]}</span>
      <span class="sx-leg-name">${esc(s.label)}</span>
      <span class="sx-leg-val num">${fmt(s.value, cur)}</span>
      <span class="sx-leg-pct num">${pct}%</span></button></li>`;
  }).join('') : `<li class="sx-legend-empty">Categories appear here as you add expenses.</li>`;
  const note = $('#donut-note');
  note.hidden = segs.length < 2;
  if (segs.length >= 2) {
    const top = segs[0];
    const pct = Math.round((top.value / data.total) * 100);
    note.innerHTML = `<span class="sx-leg-dot" style="--c:${top.color}">${C.CATEGORY_ICONS[top.key]}</span><span><b>${esc(top.label)}</b> is ${pct}% of spending, ${fmt(Math.round(top.value / Math.max(1, group().people.length)), cur)} a person.</span>`;
  }
  if (ui.donutKey && !segs.some((s) => s.key === ui.donutKey)) { ui.donutKey = null; ui.donutPinned = false; }
  paintDonutFocus();
}
function paintDonutFocus() {
  if (!donutData) return;
  const { segs, total, cur } = donutData;
  const key = ui.donutKey;
  $$('#donut .sx-seg').forEach((p) => { p.classList.toggle('is-on', p.dataset.key === key); p.classList.toggle('is-dim', !!key && p.dataset.key !== key); });
  $$('#legend .sx-leg').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.key === key && ui.donutPinned)); b.classList.toggle('is-on', b.dataset.key === key); b.classList.toggle('is-dim', !!key && b.dataset.key !== key); });
  const c = $('#donut-center');
  if (!c) return;
  const s = segs.find((x) => x.key === key);
  if (s) c.innerHTML = `<span>${esc(s.label)}</span><b class="num">${fmt(s.value, cur)}</b><small class="num">${Math.round((s.value / total) * 1000) / 10}% of spending</small>`;
  else if (total) c.innerHTML = `<span>Total</span><b class="num">${fmt(total, cur, { compact: total >= 1000000 })}</b><small>${plural(segs.length, 'category', 'categories')}</small>`;
  else c.innerHTML = `<span>No spending yet</span>`;
}
function donutHover(key) { if (ui.donutPinned) return; ui.donutKey = key; paintDonutFocus(); }
function donutPin(key) {
  if (ui.donutPinned && ui.donutKey === key) { ui.donutPinned = false; ui.donutKey = null; }
  else { ui.donutPinned = true; ui.donutKey = key; }
  paintDonutFocus();
}
$('#donut').addEventListener('pointerover', (e) => { const p = e.target.closest('.sx-seg'); if (p && e.pointerType === 'mouse') donutHover(p.dataset.key); });
$('#donut').addEventListener('pointerout', (e) => { if (e.target.closest('.sx-seg') && e.pointerType === 'mouse') donutHover(null); });
$('#donut').addEventListener('click', (e) => { const p = e.target.closest('.sx-seg'); if (p) donutPin(p.dataset.key); });
$('#legend').addEventListener('pointerover', (e) => { const b = e.target.closest('.sx-leg'); if (b && e.pointerType === 'mouse') donutHover(b.dataset.key); });
$('#legend').addEventListener('pointerleave', () => donutHover(null));
$('#legend').addEventListener('click', (e) => { const b = e.target.closest('.sx-leg'); if (b) donutPin(b.dataset.key); });
$('#legend').addEventListener('focusin', (e) => { const b = e.target.closest('.sx-leg'); if (b) donutHover(b.dataset.key); });
$('#legend').addEventListener('focusout', () => donutHover(null));

/* Balances: diverging bars around a centre line */
function renderBalances(g, data, cur) {
  const host = $('#bars');
  if (!g.people.length) {
    host.innerHTML = `<div class="sx-card-empty">${C.ICONS.people}<p>Add people to see who's up and who's down.</p><button type="button" class="zl-btn zl-btn-secondary zl-btn-sm" data-goto="people">Add people</button></div>`;
    return;
  }
  const max = Math.max(1, ...g.people.map((p) => Math.abs(data.balances[p.id])));
  host.innerHTML = g.people.map((p) => {
    const b = data.balances[p.id];
    const w = (Math.abs(b) / max) * 100;
    const cls = b > 0 ? 'pos' : b < 0 ? 'neg' : 'zero';
    const label = b > 0 ? 'gets back' : b < 0 ? 'owes' : 'square';
    return `<div class="sx-bar-row ${cls}" data-person="${esc(p.id)}">
      <span class="sx-bar-who">${avatar(p.id, g)}<span>${esc(p.name)}</span></span>
      <span class="sx-bar-track" aria-hidden="true"><span class="sx-bar-half l"><i style="width:${b < 0 ? w : 0}%"></i></span><span class="sx-bar-axis"></span><span class="sx-bar-half r"><i style="width:${b > 0 ? w : 0}%"></i></span></span>
      <span class="sx-bar-amt"><b class="num">${fmt(Math.abs(b), cur)}</b><small>${esc(label)}</small></span>
    </div>`;
  }).join('');
}

/* Settle up */
let lastTransferCount = null;
function renderSettle(g, data, cur) {
  const transfers = L.settleUp(data.balances, order(g));
  const list = $('#transfers'), done = $('#settled');
  const hasSpend = g.expenses.some((e) => e.kind !== 'payment' && e.currency === cur);
  const paid = g.expenses.filter((e) => e.kind === 'payment' && e.currency === cur).length;
  if (!hasSpend) {
    done.hidden = true;
    list.innerHTML = `<li class="sx-card-empty">${C.ICONS.receipt}<p>Nothing to settle yet. Payments appear here once someone has paid for something.</p></li>`;
    $('#settle-sub').textContent = 'The fewest payments that clear every balance.';
    lastTransferCount = 0;
    return;
  }
  if (!transfers.length) {
    list.innerHTML = '';
    const wasOpen = !done.hidden;
    done.hidden = false;
    $('#settled-text').textContent = `Everyone is square across ${plural(realExpenses(g).filter((e) => e.currency === cur).length, 'expense')}${paid ? ` and ${plural(paid, 'payment')}` : ''}.`;
    $('#settle-sub').textContent = 'Nothing left to pay.';
    if (!wasOpen && lastTransferCount > 0) celebrate();
    lastTransferCount = 0;
    return;
  }
  done.hidden = true;
  lastTransferCount = transfers.length;
  $('#settle-sub').textContent = `${plural(transfers.length, 'payment')} clear${transfers.length === 1 ? 's' : ''} every balance.`;
  list.innerHTML = transfers.map((t, i) => `<li class="sx-transfer" data-i="${i}">
      <span class="sx-tr-faces">${avatar(t.from, g)}<span class="sx-tr-arrow">${C.ICONS.arrow}</span>${avatar(t.to, g)}</span>
      <span class="sx-tr-text"><b>${esc(personName(t.from, g))} pays ${esc(personName(t.to, g))}</b><small class="num">${fmt(t.amount, cur)}</small></span>
      <b class="sx-tr-amt num">${fmt(t.amount, cur)}</b>
      <button type="button" class="zl-btn zl-btn-secondary zl-btn-sm sx-mark" data-from="${esc(t.from)}" data-to="${esc(t.to)}" data-amount="${t.amount}" data-cur="${cur}">Mark as paid</button>
    </li>`).join('');
}
$('#transfers').addEventListener('click', (e) => {
  const b = e.target.closest('.sx-mark');
  if (!b || b.disabled) return;
  b.disabled = true;
  const row = b.closest('.sx-transfer');
  const commit = () => markPaid(b.dataset.from, b.dataset.to, Number(b.dataset.amount), b.dataset.cur);
  if (reduced()) commit();
  else { row.classList.add('is-paying'); setTimeout(commit, 320); }
});
function markPaid(from, to, amount, cur) {
  const g = group();
  const p = { id: uid(), kind: 'payment', desc: `${personName(from)} paid ${personName(to)}`, amount, currency: cur, date: todayISO(), category: null,
    paidBy: from, participants: [to], mode: 'equal', notes: '', created: Date.now() };
  g.expenses.push(p);
  save();
  render();
  ZL.toast(`Payment recorded: ${personName(from)} paid ${personName(to)} ${fmt(amount, cur)}`, {
    action: { label: 'Undo', fn: () => { const gg = state.groups.find((x) => x.id === g.id); if (!gg) return; gg.expenses = gg.expenses.filter((x) => x.id !== p.id); save(); render(); ZL.toast('Payment removed', { type: 'info' }); } },
  });
}
function celebrate() {
  const box = $('#settled');
  box.classList.remove('is-celebrating');
  void box.offsetWidth;
  box.classList.add('is-celebrating');
  if (reduced()) return;
  const mark = $('#settled-mark');
  const colors = ['var(--accent)', 'var(--cat-food)', 'var(--cat-transport)', 'var(--cat-activities)', 'var(--cat-accommodation)', 'var(--cat-bills)'];
  for (let i = 0; i < 22; i++) {
    const s = document.createElement('i');
    s.className = 'sx-confetti';
    const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3;
    const d = 56 + Math.random() * 46;
    s.style.cssText = `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 10}px;--r:${Math.random() * 360}deg;--c:${colors[i % colors.length]};animation-delay:${Math.random() * 80}ms`;
    mark.appendChild(s);
    setTimeout(() => s.remove(), 1400);
  }
}
$('#copy-summary-btn').addEventListener('click', copySummary);
function copySummary() {
  const g = group();
  if (!realExpenses(g).length) { ZL.toast('Add an expense first, then there is something to share', { type: 'info' }); return; }
  Promise.resolve(ZL.copy(L.summaryText(g))).then((ok) => ZL.toast(ok ? 'Summary copied to clipboard' : 'Copy failed. Select the text and copy it instead.', { type: ok ? 'good' : 'bad' }));
}

/* ---------------- Activity ---------------- */
function describeSplit(e, g) {
  if (e.kind === 'payment') return 'Settlement';
  const n = e.participants.length;
  const everyone = n === g.people.length && n > 1;
  const who = everyone ? 'everyone' : plural(n, 'person', 'people');
  if (e.mode === 'exact') return `exact amounts, ${who}`;
  if (e.mode === 'shares') return `by shares, ${who}`;
  if (e.mode === 'items') return `itemised, ${plural((e.items || []).length, 'item')}`;
  return n === 1 ? `for ${personName(e.participants[0], g)}` : `split equally, ${who}`;
}
function fillSelect(sel, options, value) {
  sel.innerHTML = options.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  sel.value = options.some(([v]) => v === value) ? value : options[0][0];
}
function renderActivity() {
  const g = group();
  const f = ui.filters;
  if (f.person && !g.people.some((p) => p.id === f.person)) f.person = '';
  fillSelect($('#f-person'), [['', 'Everyone'], ...g.people.map((p) => [p.id, p.name])], f.person);
  fillSelect($('#f-cat'), [['', 'All categories'], ...L.CATEGORIES.map((c) => [c.id, c.label]), ['payment', 'Settlements']], f.category);
  if ($('#f-q').value !== f.q) $('#f-q').value = f.q;
  const list = L.filterExpenses(g, f);
  const total = g.expenses.length;
  const filtered = !!(f.q || f.person || f.category);
  $('#f-clear').hidden = !filtered;
  const host = $('#activity-list');
  if (!total) {
    $('#f-results').textContent = '';
    host.innerHTML = `<div class="zl-empty">${C.ICONS.receipt}<h3>No activity yet</h3><p>Expenses and settled payments show up here, newest first.</p><button type="button" class="zl-btn zl-btn-primary" data-act="add">Add expense</button></div>`;
    return;
  }
  $('#f-results').textContent = filtered ? `Showing ${list.length} of ${total}` : `${plural(realExpenses(g).length, 'expense')}${total - realExpenses(g).length ? `, ${plural(total - realExpenses(g).length, 'payment')}` : ''}`;
  if (!list.length) {
    host.innerHTML = `<div class="zl-empty">${C.ICONS.search}<h3>No matches</h3><p>Nothing matches those filters. Try a different word or person.</p><button type="button" class="zl-btn zl-btn-secondary" data-act="clear">Clear filters</button></div>`;
    return;
  }
  const days = [];
  for (const e of list) {
    const last = days[days.length - 1];
    if (last && last.date === e.date) last.items.push(e); else days.push({ date: e.date, items: [e] });
  }
  host.innerHTML = days.map((d) => {
    const sums = {};
    d.items.filter((e) => e.kind !== 'payment').forEach((e) => { sums[e.currency] = (sums[e.currency] || 0) + e.amount; });
    const sumText = Object.entries(sums).map(([c, v]) => fmt(v, c)).join(', ');
    return `<section class="sx-day"><h3><span>${esc(dayLabel(d.date))}</span><span class="num">${sumText}</span></h3><ul>${d.items.map((e) => actRow(e, g)).join('')}</ul></section>`;
  }).join('');
}
function actRow(e, g) {
  const pay = e.kind === 'payment';
  const title = pay ? `${personName(e.paidBy, g)} paid ${personName(e.participants[0], g)}` : e.desc;
  const meta = pay ? 'Settlement payment' : `${personName(e.paidBy, g)} paid, ${describeSplit(e, g)}`;
  const main = `${catTile(pay ? 'payment' : e.category)}
      <span class="sx-act-text"><b>${esc(title)}</b><small>${esc(meta)}</small>${e.notes ? `<small class="sx-act-note">${esc(e.notes)}</small>` : ''}</span>
      <span class="sx-act-amt"><b class="num">${fmt(e.amount, e.currency)}</b><small>${pay ? 'Settled' : esc(L.categoryLabel(e.category))}</small></span>`;
  return `<li class="sx-act${pay ? ' is-pay' : ''}" data-id="${esc(e.id)}">
    ${pay ? `<div class="sx-act-main">${main}</div>` : `<button type="button" class="sx-act-main" data-edit="${esc(e.id)}" aria-label="Edit ${esc(title)}, ${esc(fmt(e.amount, e.currency))}">${main}</button>`}
    <button type="button" class="zl-iconbtn sx-act-del" data-del="${esc(e.id)}" aria-label="${pay ? 'Remove payment' : 'Delete'} ${esc(title)}" data-tip="${pay ? 'Remove payment' : 'Delete'}">${C.ICONS.trash}</button>
  </li>`;
}
let qTimer;
$('#f-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.filters.q = $('#f-q').value; renderActivity(); }, 120); });
$('#f-person').addEventListener('change', () => { ui.filters.person = $('#f-person').value; renderActivity(); });
$('#f-cat').addEventListener('change', () => { ui.filters.category = $('#f-cat').value; renderActivity(); });
function clearFilters() { ui.filters = { q: '', person: '', category: '' }; renderActivity(); ZL.toast('Filters cleared', { type: 'info' }); }
$('#f-clear').addEventListener('click', clearFilters);
$('#activity-list').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-edit]');
  if (ed) { openEditor(ed.dataset.edit); return; }
  const del = e.target.closest('[data-del]');
  if (del) { deleteExpense(del.dataset.del); return; }
  const act = e.target.closest('[data-act]');
  if (act?.dataset.act === 'add') openEditor(null);
  if (act?.dataset.act === 'clear') clearFilters();
});
function deleteExpense(id) {
  const g = group();
  const idx = g.expenses.findIndex((x) => x.id === id);
  if (idx < 0) return;
  const [gone] = g.expenses.splice(idx, 1);
  save();
  render();
  const pay = gone.kind === 'payment';
  ZL.toast(pay ? 'Payment removed' : `Deleted ${gone.desc}`, {
    action: { label: 'Undo', fn: () => { const gg = state.groups.find((x) => x.id === g.id); if (!gg) return; gg.expenses.splice(Math.min(idx, gg.expenses.length), 0, gone); save(); render(); ZL.toast(pay ? 'Payment restored' : 'Expense restored'); } },
  });
}

/* ---------------- People ---------------- */
let renaming = null;
function renderPeople() {
  const g = group();
  paintBadge($('#gc-badge'), g);
  $('#gc-name').textContent = g.name;
  $('#gc-meta').textContent = `${plural(g.people.length, 'person', 'people')}, ${plural(realExpenses(g).length, 'expense')}, ${g.currency} by default`;
  const cur = activeCurrency(g);
  const data = L.computeBalances(g, cur);
  const list = $('#people-list');
  if (!g.people.length) {
    list.innerHTML = `<li class="zl-empty sx-people-empty">${C.ICONS.people}<h3>No one here yet</h3><p>Add everyone who shares costs. You need at least two people to split anything.</p></li>`;
    return;
  }
  list.innerHTML = g.people.map((p) => {
    if (renaming === p.id) {
      return `<li class="sx-person is-renaming" data-id="${esc(p.id)}">${avatar(p.id, g, 'lg')}
        <form class="sx-rename" data-rename-form>
          <label class="sr-only" for="rn-${esc(p.id)}">New name for ${esc(p.name)}</label>
          <input class="zl-input" id="rn-${esc(p.id)}" value="${esc(p.name)}" maxlength="40" autocomplete="off" aria-describedby="rn-err">
          <button type="submit" class="zl-btn zl-btn-primary zl-btn-sm">Save</button>
          <button type="button" class="zl-btn zl-btn-ghost zl-btn-sm" data-rename-cancel>Cancel</button>
        </form>
        <p class="zl-error sx-person-err" id="rn-err" role="alert"></p></li>`;
    }
    const uses = g.expenses.filter((e) => e.paidBy === p.id || e.participants.includes(p.id)).length;
    return `<li class="sx-person" data-id="${esc(p.id)}">${avatar(p.id, g, 'lg')}
      <span class="sx-person-text"><b>${esc(p.name)}</b><small class="num">${uses ? `Paid ${fmt(data.paid[p.id], cur)}, share ${fmt(data.share[p.id], cur)}` : 'Not in any expenses yet'}</small></span>
      <span class="sx-person-actions">
        <button type="button" class="zl-btn zl-btn-ghost zl-btn-sm" data-rename="${esc(p.id)}" aria-label="Rename ${esc(p.name)}">Rename</button>
        <button type="button" class="zl-btn zl-btn-ghost zl-btn-sm sx-ghost-bad" data-remove="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">Remove</button>
      </span>
      <p class="zl-error sx-person-err" role="alert"></p></li>`;
  }).join('');
  if (renaming) { const i = $('#rn-' + CSS.escape(renaming)); if (i) { i.focus(); i.select(); } }
}
function nameError(name, g, exceptId) {
  if (!name) return 'Type a name first.';
  if (g.people.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase())) return `${name} is already in this group. Add a surname or initial to tell them apart.`;
  if (g.people.length >= 50 && !exceptId) return 'A group can have up to 50 people.';
  return '';
}
$('#person-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const g = group();
  const input = $('#person-name');
  const name = input.value.trim().replace(/\s+/g, ' ');
  const err = nameError(name, g);
  $('#person-error').textContent = err;
  input.setAttribute('aria-invalid', String(!!err));
  if (err) { input.focus(); return; }
  g.people.push({ id: uid(), name });
  input.value = '';
  save();
  render();
  input.focus();
  const row = $(`#people-list .sx-person:last-child`);
  if (row) row.classList.add('is-new');
  ZL.toast(`${name} added`);
});
$('#person-name').addEventListener('input', () => { if ($('#person-error').textContent) { $('#person-error').textContent = ''; $('#person-name').setAttribute('aria-invalid', 'false'); } });
$('#people-list').addEventListener('click', (e) => {
  const g = group();
  const rn = e.target.closest('[data-rename]');
  if (rn) { renaming = rn.dataset.rename; renderPeople(); return; }
  if (e.target.closest('[data-rename-cancel]')) { renaming = null; renderPeople(); return; }
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    const id = rm.dataset.remove;
    const p = g.people.find((x) => x.id === id);
    const uses = g.expenses.filter((x) => x.paidBy === id || x.participants.includes(id));
    const errEl = rm.closest('.sx-person').querySelector('.sx-person-err');
    if (uses.length) {
      errEl.innerHTML = `${esc(p.name)} is in ${plural(uses.length, 'expense')}, so removing them would change everyone's balances. Edit or delete those first. <button type="button" class="sx-link" data-show-person="${esc(id)}">Show ${esc(p.name)}'s expenses</button>`;
      ZL.toast(`Can't remove ${p.name} while they're in expenses`, { type: 'bad' });
      return;
    }
    const idx = g.people.indexOf(p);
    g.people.splice(idx, 1);
    save();
    render();
    ZL.toast(`${p.name} removed`, { action: { label: 'Undo', fn: () => { const gg = state.groups.find((x) => x.id === g.id); if (!gg) return; gg.people.splice(Math.min(idx, gg.people.length), 0, p); save(); render(); ZL.toast(`${p.name} is back`); } } });
    return;
  }
  const show = e.target.closest('[data-show-person]');
  if (show) { ui.filters = { q: '', person: show.dataset.showPerson, category: '' }; setView('activity'); }
});
$('#people-list').addEventListener('submit', (e) => {
  if (!e.target.matches('[data-rename-form]')) return;
  e.preventDefault();
  const g = group();
  const p = g.people.find((x) => x.id === renaming);
  const input = e.target.querySelector('input');
  const name = input.value.trim().replace(/\s+/g, ' ');
  const err = nameError(name, g, p.id);
  if (err) { $('#rn-err').textContent = err; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
  const old = p.name;
  p.name = name;
  renaming = null;
  save();
  render();
  ZL.toast(old === name ? 'No changes' : `Renamed ${old} to ${name}`, { type: old === name ? 'info' : 'good' });
});
$('#people-list').addEventListener('keydown', (e) => { if (e.key === 'Escape' && renaming) { renaming = null; renderPeople(); } });

/* ---------------- Expense editor ---------------- */
let draft = null;
let editorReturn = 'overview';
const fmtShare = (h) => String(h / 100);

function showEditor(on) {
  $('#view-editor').hidden = !on;
  $('#toolbar').hidden = on;
  for (const v of VIEWS) $('#view-' + v).hidden = on ? true : v !== ui.view;
  $('#split-app').classList.toggle('is-editing', on);
}
function openEditor(id, { tour = false } = {}) {
  const g = group();
  if (!tour && g.people.length < 2) {
    ZL.toast(g.people.length ? 'Add one more person to split costs' : 'Add at least two people first', { type: 'info' });
    setView('people');
    $('#person-name').focus();
    return;
  }
  const e = id ? g.expenses.find((x) => x.id === id && x.kind !== 'payment') : null;
  if (id && !e) return;
  if (ui.view !== 'editor') editorReturn = ui.view;
  const ids = order(g);
  draft = {
    id: e?.id || null, mode: e?.mode || 'equal', category: e?.category || 'other', catManual: !!e,
    participants: new Set(e && e.mode !== 'items' ? e.participants : ids), exact: {}, shares: {}, items: [],
    amountAuto: !e, submitted: false, touched: {}, dirty: false,
  };
  ids.forEach((pid) => { draft.exact[pid] = ''; draft.shares[pid] = '1'; });
  if (e?.mode === 'exact') ids.forEach((pid) => { draft.exact[pid] = e.exact?.[pid] != null && e.participants.includes(pid) ? L.toInputAmount(e.exact[pid], e.currency) : ''; });
  if (e?.mode === 'shares') ids.forEach((pid) => { if (e.shares?.[pid] != null) draft.shares[pid] = fmtShare(e.shares[pid]); });
  if (e?.mode === 'items') draft.items = e.items.map((it) => ({ id: it.id, name: it.name, amount: L.toInputAmount(it.amount, e.currency), people: new Set(it.people) }));
  $('#e-desc').value = e?.desc || '';
  $('#e-amount').value = e ? L.toInputAmount(e.amount, e.currency) : '';
  $('#e-date').value = e?.date || todayISO();
  $('#e-notes').value = e?.notes || '';
  $('#e-tax').value = e?.mode === 'items' && e.taxPct ? L.formatPercent(e.taxPct) : '';
  $('#e-tip').value = e?.mode === 'items' && e.tipPct ? L.formatPercent(e.tipPct) : '';
  fillSelect($('#e-currency'), L.CURRENCIES.map((c) => [c.code, `${c.code}, ${c.name}`]), e?.currency || g.currency);
  fillSelect($('#e-paid'), g.people.length ? g.people.map((p) => [p.id, p.name]) : [['', 'Add people first']], e?.paidBy || ids[0] || '');
  $('#editor-title').textContent = e ? 'Edit expense' : 'Add expense';
  $('#editor-save').textContent = e ? 'Save changes' : 'Add expense';
  $('#editor-delete').hidden = !e;
  $('#form-error').textContent = '';
  ui.view = 'editor';
  showEditor(true);
  renderCats();
  renderModeUi();
  updatePreview();
  const app = $('#split-app').getBoundingClientRect();
  if (!tour && (app.top < 0 || app.top > innerHeight * 0.6)) $('#app').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  if (!tour) setTimeout(() => $('#e-desc').focus({ preventScroll: true }), 30);
}
async function requestCloseEditor() {
  if (draft?.dirty) {
    const ok = await ZL.confirm({ title: 'Discard this expense?', body: 'Your changes have not been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true });
    if (!ok) return;
  }
  closeEditor();
}
function closeEditor(silent) {
  if (ui.view !== 'editor') return;
  ui.view = editorReturn;
  draft = null;
  showEditor(false);
  if (!silent) setView(ui.view);
}
$('#editor-back').addEventListener('click', requestCloseEditor);
$('#editor-cancel').addEventListener('click', requestCloseEditor);
$('#view-editor').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog[open]')) requestCloseEditor(); });
$('#editor-delete').addEventListener('click', () => { const id = draft?.id; closeEditor(); if (id) deleteExpense(id); });
$('#add-btn').addEventListener('click', () => openEditor(null));

function renderCats() {
  $('#e-cats').innerHTML = L.CATEGORIES.map((c) => {
    const on = c.id === draft.category;
    return `<button type="button" role="radio" class="sx-cat" data-cat="${c.id}" aria-checked="${on}" tabindex="${on ? 0 : -1}" style="--c:var(--cat-${c.id})">${C.CATEGORY_ICONS[c.id]}<span>${esc(c.label)}</span></button>`;
  }).join('');
  $('#e-cat-hint').textContent = draft.catManual ? 'Used for the category chart and filters.' : 'Picked from the description. Tap to change.';
}
function setCategory(id, manual) {
  draft.category = id;
  if (manual) draft.catManual = true;
  $$('#e-cats .sx-cat').forEach((b) => { const on = b.dataset.cat === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  $('#e-cat-hint').textContent = draft.catManual ? 'Used for the category chart and filters.' : 'Picked from the description. Tap to change.';
}
$('#e-cats').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { setCategory(b.dataset.cat, true); draft.dirty = true; } });
$('#e-cats').addEventListener('keydown', (e) => {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in keys)) return;
  const ids = L.CATEGORY_IDS;
  const next = ids[(ids.indexOf(draft.category) + keys[e.key] + ids.length) % ids.length];
  setCategory(next, true);
  $(`#e-cats [data-cat="${next}"]`).focus();
  e.preventDefault();
});

function setMode(mode) {
  draft.mode = mode;
  draft.dirty = true;
  if (mode === 'items') {
    if (!$('#e-amount').value.trim()) draft.amountAuto = true;
    if (!draft.items.length) draft.items.push(newItem());
  }
  renderModeUi();
  updatePreview();
}
function newItem() { return { id: uid(), name: '', amount: '', people: new Set() }; }
$('#e-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && b.dataset.mode !== draft.mode) setMode(b.dataset.mode); });
function renderModeUi() {
  $$('#e-mode [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === draft.mode)));
  $('#e-mode-hint').textContent = MODE_HINTS[draft.mode];
  const items = draft.mode === 'items';
  $('#split-people').hidden = items;
  $('#split-items').hidden = !items;
  if (items) renderItems(); else renderSplitPeople();
}
function renderSplitPeople() {
  const g = group();
  const m = draft.mode;
  if (!g.people.length) { $('#split-people').innerHTML = '<p class="zl-hint">Add people to this group to choose who shares this.</p>'; return; }
  const allOn = g.people.every((p) => draft.participants.has(p.id));
  $('#split-people').innerHTML = `<div class="sx-sp-head"><span class="zl-label" id="sp-label">Split between</span>
      <button type="button" class="zl-btn zl-btn-ghost zl-btn-sm" id="sp-all">${allOn ? 'Clear all' : 'Select all'}</button></div>
    <ul class="sx-sp-list" aria-labelledby="sp-label">${g.people.map((p) => {
      const on = draft.participants.has(p.id);
      const input = m === 'exact'
        ? `<input class="zl-input sx-mini num" id="x-${esc(p.id)}" data-exact="${esc(p.id)}" inputmode="decimal" placeholder="0.00" value="${esc(draft.exact[p.id] || '')}" aria-label="Amount for ${esc(p.name)}" ${on ? '' : 'disabled'}>`
        : m === 'shares'
          ? `<input class="zl-input sx-mini num" id="s-${esc(p.id)}" data-share="${esc(p.id)}" inputmode="decimal" value="${esc(draft.shares[p.id] ?? '1')}" aria-label="Shares for ${esc(p.name)}" ${on ? '' : 'disabled'}>`
          : '';
      return `<li class="sx-sp-row${on ? '' : ' is-off'}" data-id="${esc(p.id)}">
        <label class="sx-sp-who"><input type="checkbox" class="sx-check" data-part="${esc(p.id)}" ${on ? 'checked' : ''}>${avatar(p.id, g)}<span>${esc(p.name)}</span></label>
        ${input}<b class="sx-sp-amt num" id="pa-${esc(p.id)}"></b>
        <span class="zl-error sx-sp-err" id="pe-${esc(p.id)}"></span></li>`;
    }).join('')}</ul>`;
}
$('#split-people').addEventListener('change', (e) => {
  const c = e.target.closest('[data-part]');
  if (!c) return;
  const id = c.dataset.part;
  if (c.checked) draft.participants.add(id); else draft.participants.delete(id);
  draft.dirty = true;
  const row = c.closest('.sx-sp-row');
  row.classList.toggle('is-off', !c.checked);
  const inp = row.querySelector('input.sx-mini');
  if (inp) inp.disabled = !c.checked;
  $('#sp-all').textContent = group().people.every((p) => draft.participants.has(p.id)) ? 'Clear all' : 'Select all';
  updatePreview();
});
$('#split-people').addEventListener('click', (e) => {
  if (!e.target.closest('#sp-all')) return;
  const g = group();
  const allOn = g.people.every((p) => draft.participants.has(p.id));
  draft.participants = new Set(allOn ? [] : g.people.map((p) => p.id));
  draft.dirty = true;
  renderSplitPeople();
  updatePreview();
});
$('#split-people').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.exact) draft.exact[t.dataset.exact] = t.value;
  if (t.dataset.share) draft.shares[t.dataset.share] = t.value;
  draft.dirty = true;
  updatePreview();
});
$('#split-people').addEventListener('focusout', (e) => { const t = e.target; if (t.dataset.exact || t.dataset.share) { draft.touched['p-' + (t.dataset.exact || t.dataset.share)] = true; updatePreview(); } });

function renderItems() {
  const g = group();
  const list = $('#item-list');
  list.innerHTML = draft.items.length ? `<li class="sx-item-cols" aria-hidden="true"><span>Item</span><span>Price</span></li>` + draft.items.map((it, i) => `<li class="sx-item" data-item="${esc(it.id)}">
      <div class="sx-item-top">
        <input class="zl-input sx-item-name" data-iname="${esc(it.id)}" maxlength="60" placeholder="Item ${i + 1}" value="${esc(it.name)}" aria-label="Item ${i + 1} name" autocomplete="off">
        <input class="zl-input sx-item-amt num" data-iamt="${esc(it.id)}" inputmode="decimal" placeholder="0.00" value="${esc(it.amount)}" aria-label="Item ${i + 1} price" autocomplete="off">
        <button type="button" class="zl-iconbtn sx-item-del" data-idel="${esc(it.id)}" aria-label="Remove item ${i + 1}">${C.ICONS.x}</button>
      </div>
      <div class="sx-item-people" role="group" aria-label="Who had item ${i + 1}">${g.people.map((p) =>
        `<button type="button" class="sx-pchip" data-ip="${esc(it.id)}" data-p="${esc(p.id)}" aria-pressed="${it.people.has(p.id)}">${avatar(p.id, g)}${esc(p.name)}</button>`).join('')}</div>
      <span class="zl-error" id="ie-${esc(it.id)}"></span>
    </li>`).join('') : `<li class="zl-hint sx-items-empty">No items yet. Add the first line from the receipt.</li>`;
}
function findItem(id) { return draft.items.find((x) => x.id === id); }
$('#item-list').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.iname) findItem(t.dataset.iname).name = t.value;
  if (t.dataset.iamt) findItem(t.dataset.iamt).amount = t.value;
  draft.dirty = true;
  updatePreview();
});
$('#item-list').addEventListener('focusout', (e) => { const id = e.target.dataset?.iamt; if (id) { draft.touched['i-' + id] = true; updatePreview(); } });
$('#item-list').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-ip]');
  if (chip) {
    const it = findItem(chip.dataset.ip);
    const p = chip.dataset.p;
    if (it.people.has(p)) it.people.delete(p); else it.people.add(p);
    chip.setAttribute('aria-pressed', String(it.people.has(p)));
    draft.touched['i-' + it.id] = true;
    draft.dirty = true;
    updatePreview();
    return;
  }
  const del = e.target.closest('[data-idel]');
  if (del) {
    draft.items = draft.items.filter((x) => x.id !== del.dataset.idel);
    draft.dirty = true;
    renderItems();
    updatePreview();
    const last = $$('#item-list .sx-item-name').pop();
    (last || $('#add-item')).focus();
  }
});
$('#add-item').addEventListener('click', () => {
  draft.items.push(newItem());
  draft.dirty = true;
  renderItems();
  updatePreview();
  $$('#item-list .sx-item-name').pop().focus();
});

for (const id of ['e-desc', 'e-amount', 'e-date', 'e-notes', 'e-tax', 'e-tip', 'e-currency', 'e-paid']) {
  const el = $('#' + id);
  el.addEventListener('input', () => {
    if (!draft) return;
    draft.dirty = true;
    if (id === 'e-amount') draft.amountAuto = false;
    if (id === 'e-desc' && !draft.catManual) { const guess = L.guessCategory(el.value); if (guess) setCategory(guess, false); }
    updatePreview();
  });
  el.addEventListener('change', () => { if (draft && (id === 'e-currency' || id === 'e-paid')) updatePreview(); });
  el.addEventListener('blur', () => { if (draft) { draft.touched[id] = true; updatePreview(); } });
}

/* Validation and live preview. evaluate() reads the form and returns the expense, per-person
   amounts, a status line and every error. Errors only show once a field is touched or on save. */
function evaluate() {
  const g = group();
  const ids = order(g);
  const cur = $('#e-currency').value;
  const errors = {};
  const out = { per: {}, status: null, errors, cur, meter: null };
  const desc = $('#e-desc').value.trim().replace(/\s+/g, ' ');
  if (!desc) errors['e-desc'] = 'Add a short description, like Dinner or Villa.';
  let amt = L.parseAmount($('#e-amount').value, cur);
  const date = $('#e-date').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors['e-date'] = 'Pick the date it was paid.';
  const paidBy = $('#e-paid').value;
  if (!g.people.some((p) => p.id === paidBy)) errors.form = 'Add people to this group first.';
  const mode = draft.mode;
  const expense = { kind: 'expense', desc, currency: cur, date, category: draft.category, paidBy, mode, notes: $('#e-notes').value.trim().slice(0, 500) };

  if (mode === 'items') {
    const items = draft.items.map((it, i) => {
      const r = it.amount.trim() === '' ? { error: 'Enter a price for this item.' } : L.parseAmount(it.amount, cur, { allowZero: true });
      const msg = r.error || (it.people.size ? '' : 'Tap who had this item.');
      if (msg) errors['i-' + it.id] = msg;
      return { id: it.id, name: it.name.trim() || `Item ${i + 1}`, amount: r.value || 0, people: ids.filter((p) => it.people.has(p)) };
    });
    const tax = L.parsePercent($('#e-tax').value);
    const tip = L.parsePercent($('#e-tip').value);
    if (Number.isNaN(tax)) errors['e-tax'] = 'Enter a percentage from 0 to 100, like 10.';
    if (Number.isNaN(tip)) errors['e-tip'] = 'Enter a percentage from 0 to 100, like 15.';
    const b = L.itemBreakdown({ items, taxPct: tax || 0, tipPct: tip || 0 }, ids);
    out.breakdown = b;
    out.taxBp = tax || 0;
    out.tipBp = tip || 0;
    if (draft.amountAuto && b.total > 0) {
      const v = L.toInputAmount(b.total, cur);
      if ($('#e-amount').value !== v) $('#e-amount').value = v;
      amt = { value: b.total };
    }
    for (const id of b.ids) out.per[id] = b.people[id].total;
    Object.assign(expense, { items, taxPct: tax || 0, tipPct: tip || 0, participants: b.ids });
    if (!draft.items.length) {
      errors.form = 'Add at least one item from the receipt.';
      out.status = { kind: 'warn', text: 'Add the first item from the receipt.' };
    } else if (amt.value) {
      const rem = amt.value - b.total;
      out.meter = Math.min(1, b.total / amt.value);
      if (rem > 0) {
        out.status = { kind: 'warn', text: `${fmt(rem, cur)} left to assign`, sub: `Items, tax and tip come to ${fmt(b.total, cur)} of ${fmt(amt.value, cur)}.`, action: b.total ? { label: `Use ${fmt(b.total, cur)} as the amount`, value: b.total } : null };
        errors.form = errors.form || `Assign the remaining ${fmt(rem, cur)}, or change the amount to match the receipt.`;
      } else if (rem < 0) {
        out.status = { kind: 'bad', text: `${fmt(-rem, cur)} over the amount`, sub: `Items, tax and tip come to ${fmt(b.total, cur)}.`, action: { label: `Use ${fmt(b.total, cur)} as the amount`, value: b.total } };
        errors.form = errors.form || `The receipt comes to ${fmt(-rem, cur)} more than the amount. Check the prices or update the amount.`;
      } else {
        out.status = { kind: 'good', text: `All ${fmt(amt.value, cur)} assigned`, sub: draft.amountAuto ? 'The amount is filled in from the receipt.' : 'The receipt matches the amount.' };
      }
    } else {
      out.status = { kind: 'warn', text: 'Enter prices for the items', sub: 'The amount fills in from the receipt as you go.' };
    }
  } else {
    const parts = ids.filter((id) => draft.participants.has(id));
    expense.participants = parts;
    if (!parts.length) { errors.form = errors.form || 'Choose at least one person to split with.'; out.status = { kind: 'bad', text: 'Choose who this was for' }; }
    if (mode === 'equal' && parts.length) {
      if (amt.value) {
        out.per = L.splitEqual(amt.value, parts);
        const base = Math.floor(amt.value / parts.length);
        const even = base * parts.length === amt.value;
        out.status = parts.length === 1
          ? { kind: 'good', text: `${personName(parts[0])} pays the full ${fmt(amt.value, cur)}` }
          : { kind: 'good', text: even ? `${fmt(base, cur)} each` : `${fmt(base + 1, cur)} or ${fmt(base, cur)} each`, sub: `Split equally between ${plural(parts.length, 'person', 'people')}.` };
      } else out.status = { kind: '', text: 'Enter the amount to see each share' };
    }
    if (mode === 'exact') {
      const exact = {};
      let sum = 0;
      for (const id of parts) {
        const s = String(draft.exact[id] || '').trim();
        if (!s) { exact[id] = 0; continue; }
        const r = L.parseAmount(s, cur, { allowZero: true });
        if (r.error) errors['p-' + id] = r.error; else { exact[id] = r.value; sum += r.value; }
      }
      out.per = exact;
      expense.exact = exact;
      if (amt.value && parts.length) {
        const rem = amt.value - sum;
        out.meter = Math.min(1, sum / amt.value);
        if (rem > 0) { out.status = { kind: 'warn', text: `${fmt(rem, cur)} left to assign`, sub: `${fmt(sum, cur)} of ${fmt(amt.value, cur)} assigned.` }; errors.form = errors.form || `Assign the remaining ${fmt(rem, cur)} before saving.`; }
        else if (rem < 0) { out.status = { kind: 'bad', text: `${fmt(-rem, cur)} over the total`, sub: `The amounts add up to ${fmt(sum, cur)}.` }; errors.form = errors.form || `The amounts add up to ${fmt(-rem, cur)} more than the total.`; }
        else out.status = { kind: 'good', text: `All ${fmt(amt.value, cur)} assigned` };
      } else if (parts.length) out.status = { kind: '', text: 'Enter the amount, then what each person owes' };
    }
    if (mode === 'shares') {
      const shares = {};
      let total = 0;
      for (const id of parts) {
        const v = L.parseShare(draft.shares[id]);
        if (Number.isNaN(v)) errors['p-' + id] = 'Use a number like 1 or 1.5.'; else { shares[id] = v; total += v; }
      }
      expense.shares = shares;
      if (parts.length && !total && !parts.some((id) => errors['p-' + id])) { errors.form = errors.form || 'Give at least one person a share.'; out.status = { kind: 'bad', text: 'Give at least one person a share' }; }
      else if (amt.value && total) {
        out.per = L.allocate(amt.value, parts, shares);
        out.status = { kind: 'good', text: `${fmtShare(total)} shares in total`, sub: `About ${fmt(Math.round((amt.value * 100) / total), cur)} per share.` };
      } else if (parts.length) out.status = { kind: '', text: 'Enter the amount to see each share' };
    }
  }
  if (amt.error) errors['e-amount'] = amt.error;
  expense.amount = amt.value;
  out.expense = Object.keys(errors).length ? null : expense;
  return out;
}

const STATUS_ICON = { good: C.ICONS.check, warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>', bad: ZL.icons.alert };
function updatePreview() {
  if (!draft) return null;
  const ev = evaluate();
  const g = group();
  const shown = (k) => draft.submitted || draft.touched[k];
  for (const id of ['e-desc', 'e-amount', 'e-date', 'e-tax', 'e-tip']) {
    const msg = shown(id) ? ev.errors[id] || '' : '';
    $('#' + id + '-err').textContent = msg;
    $('#' + id).setAttribute('aria-invalid', String(!!msg));
  }
  if (draft.mode !== 'items') {
    $('#split-people').dataset.mode = draft.mode;
    for (const p of g.people) {
      const on = draft.participants.has(p.id);
      const el = $('#pa-' + CSS.escape(p.id));
      if (el) el.textContent = !on ? 'Not included' : draft.mode === 'exact' ? '' : ev.per[p.id] != null ? fmt(ev.per[p.id], ev.cur) : '';
      const pe = $('#pe-' + CSS.escape(p.id));
      const msg = on && shown('p-' + p.id) ? ev.errors['p-' + p.id] || '' : '';
      if (pe) pe.textContent = msg;
      const inp = $(`#split-people [data-exact="${CSS.escape(p.id)}"], #split-people [data-share="${CSS.escape(p.id)}"]`);
      if (inp) inp.setAttribute('aria-invalid', String(!!msg));
    }
  } else {
    for (const it of draft.items) {
      const msg = shown('i-' + it.id) ? ev.errors['i-' + it.id] || '' : '';
      const el = $('#ie-' + CSS.escape(it.id));
      if (el) el.textContent = msg;
      const a = $(`#item-list [data-iamt="${CSS.escape(it.id)}"]`);
      if (a) a.setAttribute('aria-invalid', String(!!msg && /price|amount|decimal|number|large|cents/i.test(msg)));
    }
    const b = ev.breakdown;
    setHTML($('#receipt-sum'), `<div><dt>Items</dt><dd class="num">${fmt(b.subtotal, ev.cur)}</dd></div>
      <div><dt>Tax${ev.taxBp ? ' ' + L.formatPercent(ev.taxBp) + '%' : ''}</dt><dd class="num">${fmt(b.tax, ev.cur)}</dd></div>
      <div><dt>Tip or service${ev.tipBp ? ' ' + L.formatPercent(ev.tipBp) + '%' : ''}</dt><dd class="num">${fmt(b.tip, ev.cur)}</dd></div>
      <div class="is-total"><dt>Receipt total</dt><dd class="num">${fmt(b.total, ev.cur)}</dd></div>`);
    setHTML($('#items-each'), b.ids.length ? `<p class="zl-label">Each person pays</p><ul>${b.ids.map((id) => {
      const x = b.people[id];
      return `<li data-person="${esc(id)}">${avatar(id, g)}<span class="sx-each-name">${esc(personName(id, g))}<small class="num">${fmt(x.items, ev.cur)} items${x.tax || x.tip ? ` + ${fmt(x.tax + x.tip, ev.cur)} tax and tip` : ''}</small></span><b class="num">${fmt(x.total, ev.cur)}</b></li>`;
    }).join('')}</ul>` : '');
  }
  const s = ev.status;
  setHTML($('#split-status'), s ? `<div class="sx-status${s.kind ? ' is-' + s.kind : ''}">
      ${s.kind ? `<span class="sx-status-icon">${STATUS_ICON[s.kind]}</span>` : ''}
      <span class="sx-status-text"><b>${esc(s.text)}</b>${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</span>
      ${s.action ? `<button type="button" class="zl-btn zl-btn-secondary zl-btn-sm" data-use-amount="${s.action.value}">${esc(s.action.label)}</button>` : ''}
    </div>${ev.meter != null ? `<div class="sx-meter${s?.kind ? ' is-' + s.kind : ''}" aria-hidden="true"><i style="width:${(ev.meter * 100).toFixed(1)}%"></i></div>` : ''}` : '');
  const anyField = Object.keys(ev.errors).some((k) => k !== 'form');
  $('#form-error').textContent = draft.submitted ? ev.errors.form || (anyField ? 'Fix the highlighted fields to save.' : '') : '';
  return ev;
}
$('#split-status').addEventListener('click', (e) => {
  const b = e.target.closest('[data-use-amount]');
  if (!b) return;
  $('#e-amount').value = L.toInputAmount(Number(b.dataset.useAmount), $('#e-currency').value);
  draft.amountAuto = true;
  draft.dirty = true;
  updatePreview();
  ZL.toast('Amount updated to match the receipt', { type: 'info' });
});

$('#view-editor').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!draft) return;
  draft.submitted = true;
  const ev = updatePreview();
  if (!ev.expense) {
    const keys = ['e-desc', 'e-amount', 'e-date', ...group().people.map((p) => 'p-' + p.id), ...draft.items.map((i) => 'i-' + i.id), 'e-tax', 'e-tip'];
    const first = keys.find((k) => ev.errors[k]);
    let el = null;
    if (first?.startsWith('p-')) el = $(`#split-people [data-exact="${CSS.escape(first.slice(2))}"], #split-people [data-share="${CSS.escape(first.slice(2))}"]`);
    else if (first?.startsWith('i-')) el = $(`#item-list [data-item="${CSS.escape(first.slice(2))}"] input`);
    else if (first) el = $('#' + first);
    (el || $('#editor-save')).focus();
    return;
  }
  const g = group();
  const editing = !!draft.id;
  if (editing) {
    const i = g.expenses.findIndex((x) => x.id === draft.id);
    const old = g.expenses[i];
    g.expenses[i] = Object.assign({ id: old.id, created: old.created }, ev.expense);
  } else {
    g.expenses.push(Object.assign({ id: uid(), created: Date.now() }, ev.expense));
  }
  ui.cur = ev.expense.currency;
  if (!editing && editorReturn === 'people') editorReturn = 'overview';
  save();
  closeEditor();
  render();
  ZL.toast(editing ? 'Changes saved' : `Added ${ev.expense.desc}, ${fmt(ev.expense.amount, ev.expense.currency)}`);
});

/* ---------------- Group dialog ---------------- */
const EMOJI_NAMES = { '🏝️': 'Island', '🏠': 'House', '🍽️': 'Dinner', '✈️': 'Plane', '🎉': 'Party', '🏕️': 'Camping', '🚗': 'Car', '⛷️': 'Skiing', '🍻': 'Drinks', '🎓': 'Uni', '💼': 'Work', '🛒': 'Shopping' };
let gd = null;
function openGroupDialog(g) {
  const used = new Set(state.groups.map((x) => x.color));
  gd = { id: g ? g.id : null, name: g?.name || '', emoji: g ? g.emoji : '', color: g?.color || L.COLORS.find((c) => !used.has(c)) || 'green', currency: g?.currency || group().currency || 'AUD' };
  $('#gd-title').textContent = g ? 'Group settings' : 'New group';
  $('#gd-save').textContent = g ? 'Save changes' : 'Create group';
  $('#gd-delete').hidden = !g;
  $('#gd-name').value = gd.name;
  $('#gd-name-err').textContent = '';
  $('#gd-name').setAttribute('aria-invalid', 'false');
  fillSelect($('#gd-currency'), L.CURRENCIES.map((c) => [c.code, `${c.code}, ${c.name}`]), gd.currency);
  paintGroupDialog();
  $('#group-dialog').showModal();
  $('#gd-name').focus();
}
function paintGroupDialog() {
  const preview = { name: $('#gd-name').value || 'G', emoji: gd.emoji, color: gd.color };
  paintBadge($('#gd-badge'), preview);
  $('#gd-emoji').innerHTML = ['', ...EMOJIS].map((em) => `<button type="button" role="radio" class="sx-emoji" data-emoji="${em}" aria-checked="${gd.emoji === em}" aria-label="${em ? EMOJI_NAMES[em] : 'No emoji, use the first letter'}">${em || esc((preview.name.trim()[0] || 'A').toUpperCase())}</button>`).join('');
  $('#gd-color').innerHTML = L.COLORS.map((c) => `<button type="button" role="radio" class="sx-swatch" data-color="${c}" aria-checked="${gd.color === c}" aria-label="${COLOR_LABELS[c]}"></button>`).join('');
}
$('#gd-name').addEventListener('input', () => { paintBadge($('#gd-badge'), { name: $('#gd-name').value || 'G', emoji: gd.emoji, color: gd.color }); $('#gd-name-err').textContent = ''; $('#gd-name').setAttribute('aria-invalid', 'false'); const none = $('#gd-emoji [data-emoji=""]'); if (none) none.textContent = ($('#gd-name').value.trim()[0] || 'A').toUpperCase(); });
$('#gd-emoji').addEventListener('click', (e) => { const b = e.target.closest('[data-emoji]'); if (b) { gd.emoji = b.dataset.emoji; paintGroupDialog(); $(`#gd-emoji [data-emoji="${gd.emoji}"]`).focus(); } });
$('#gd-color').addEventListener('click', (e) => { const b = e.target.closest('[data-color]'); if (b) { gd.color = b.dataset.color; paintGroupDialog(); $(`#gd-color [data-color="${gd.color}"]`).focus(); } });
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('#group-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#gd-name').value.trim().replace(/\s+/g, ' ');
  if (!name) { $('#gd-name-err').textContent = 'Give the group a name, like Bali trip or Share house.'; $('#gd-name').setAttribute('aria-invalid', 'true'); $('#gd-name').focus(); return; }
  const currency = $('#gd-currency').value;
  if (gd.id) {
    const g = state.groups.find((x) => x.id === gd.id);
    Object.assign(g, { name, emoji: gd.emoji, color: gd.color, currency });
    save();
    render();
    $('#group-dialog').close();
    ZL.toast('Group updated');
  } else {
    const g = Object.assign(blankGroup(name), { emoji: gd.emoji, color: gd.color, currency });
    state.groups.push(g);
    state.activeId = g.id;
    ui.cur = null;
    lastTransferCount = null;
    save();
    $('#group-dialog').close();
    setView('people');
    render();
    $('#person-name').focus();
    ZL.toast(`Created ${name}. Add the people next.`);
  }
});
$('#gd-delete').addEventListener('click', async () => {
  const g = state.groups.find((x) => x.id === gd.id);
  if (!g) return;
  const ok = await ZL.confirm({
    title: `Delete ${g.name}?`,
    body: `This removes ${plural(g.people.length, 'person', 'people')} and ${plural(g.expenses.length, 'record')} from this device. It can't be undone. Share a link or export a CSV first if you want a copy.`,
    confirmLabel: 'Delete group', danger: true,
  });
  if (!ok) return;
  state.groups = state.groups.filter((x) => x.id !== g.id);
  if (!state.groups.length) state.groups.push(blankGroup());
  if (state.activeId === g.id) state.activeId = state.groups[0].id;
  ui.cur = null;
  lastTransferCount = null;
  save();
  $('#group-dialog').close();
  if (ui.view === 'editor') closeEditor(true);
  render();
  ZL.toast(`Deleted ${g.name}`);
});

/* ---------------- Share, import, export ---------------- */
$('#share-btn').addEventListener('click', openShare);
async function openShare() {
  const g = group();
  if (!g.people.length) { ZL.toast('Add people and expenses first, then share the group', { type: 'info' }); return; }
  $('#sd-title').textContent = `Share ${g.name}`;
  $('#summary-pre').textContent = L.summaryText(g);
  const link = $('#share-link'), btn = $('#copy-link');
  link.value = 'Preparing link…';
  link.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  $('#share-dialog').showModal();
  const code = await L.encodeShare(g);
  const url = location.href.split('#')[0] + '#share=' + code;
  link.value = url;
  link.removeAttribute('aria-busy');
  btn.disabled = false;
  const kb = (url.length / 1024).toFixed(1);
  $('#share-hint').textContent = `The group is packed into this ${kb} KB link. Nothing is uploaded, and opening it shows a preview before anything is imported.` +
    (url.length > 8000 ? ' Some chat apps cut off links this long, so a CSV may travel better.' : '');
}
$('#copy-link').addEventListener('click', () => {
  Promise.resolve(ZL.copy($('#share-link').value)).then((ok) => ZL.toast(ok ? 'Link copied to clipboard' : 'Copy failed. Select the link and copy it instead.', { type: ok ? 'good' : 'bad' }));
});
$('#share-link').addEventListener('focus', (e) => e.target.select());
$('#copy-summary').addEventListener('click', copySummary);
$('#export-csv').addEventListener('click', () => {
  const g = group();
  if (!g.expenses.length) { ZL.toast('Nothing to export yet. Add an expense first.', { type: 'info' }); return; }
  const blob = new Blob(['﻿' + L.toCSV(g)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const slug = g.name.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'group';
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  ZL.toast(`Exported ${a.download}`);
});

let pendingImport = null;
async function checkHash() {
  const h = location.hash;
  if (!h.startsWith('#share=')) return;
  const code = decodeURIComponent(h.slice(7));
  history.replaceState(null, '', location.pathname + location.search);
  const g = await L.decodeShare(code);
  if (!g) { ZL.toast('That share link is damaged or incomplete. Ask for a fresh link.', { type: 'bad', duration: 6000 }); return; }
  pendingImport = g;
  const cur = L.currenciesUsed(g)[0];
  const tot = L.computeBalances(g, cur).total;
  const n = g.expenses.filter((e) => e.kind !== 'payment').length;
  $('#import-preview').innerHTML = `<div class="sx-import-head"><span class="sx-gbadge lg" data-color="${esc(g.color)}" aria-hidden="true">${badgeInner(g)}</span>
      <div><b>${esc(g.name)}</b><small>${plural(g.people.length, 'person', 'people')}, ${plural(n, 'expense')}</small></div></div>
    <div class="zl-stat"><b class="num">${fmt(tot, cur)}</b><span>Total spent${L.currenciesUsed(g).length > 1 ? ` in ${cur}, plus other currencies` : ''}</span></div>
    <ul class="sx-import-people">${g.people.map((p) => `<li>${avatar(p.id, g)}${esc(p.name)}</li>`).join('')}</ul>`;
  $('#import-dialog').showModal();
  $('#import-ok').focus();
}
$('#import-cancel').addEventListener('click', () => { pendingImport = null; $('#import-dialog').close(); ZL.toast('Nothing was imported', { type: 'info' }); });
$('#import-dialog').addEventListener('cancel', () => { pendingImport = null; });
$('#import-ok').addEventListener('click', () => {
  if (!pendingImport) return;
  const g = Object.assign(pendingImport, { id: uid(), created: Date.now() });
  if (state.groups.some((x) => x.name === g.name)) g.name = `${g.name} (shared)`.slice(0, 40);
  const cur = group();
  if (state.groups.length === 1 && !cur.people.length && !cur.expenses.length) state.groups = [];
  state.groups.push(g);
  state.activeId = g.id;
  pendingImport = null;
  ui.cur = null;
  lastTransferCount = null;
  if (ui.view === 'editor') closeEditor(true);
  ui.view = 'overview';
  save();
  $('#import-dialog').close();
  setView('overview');
  render();
  $('#app').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  ZL.toast(`Imported ${g.name}`);
});
addEventListener('hashchange', checkHash);

/* ---------------- Example ---------------- */
$('#example-btn').addEventListener('click', loadExample);
function loadExample() {
  const before = JSON.stringify(state);
  const ex = X.exampleGroup();
  const existing = state.groups.find((g) => g.isExample);
  const cur = group();
  let target;
  if (existing) target = Object.assign(existing, ex, { id: existing.id });
  else if (!cur.people.length && !cur.expenses.length) target = Object.assign(cur, ex, { id: cur.id });
  else { target = Object.assign(ex, { id: uid(), created: Date.now() }); state.groups.push(target); }
  state.activeId = target.id;
  ui.cur = 'AUD';
  ui.filters = { q: '', person: '', category: '' };
  lastTransferCount = null;
  if (ui.view === 'editor') closeEditor(true);
  save();
  setView('overview');
  render();
  ZL.toast('Loaded a Bali trip for four', { action: { label: 'Undo', fn: () => { state = JSON.parse(before); state.groups = state.groups.map(revive).filter(Boolean); lastTransferCount = null; save(); render(); ZL.toast('Example removed', { type: 'info' }); } } });
}

/* ---------------- Render and start ---------------- */
function renderView() {
  if (ui.view === 'overview') renderOverview();
  else if (ui.view === 'activity') renderActivity();
  else if (ui.view === 'people') renderPeople();
  renderCurrencySwitch();
}
function render() { renderAppbar(); renderView(); }

addEventListener('storage', (e) => {
  if (e.key !== 'zl:split-it:state' || ui.view === 'editor') return;
  state = load();
  render();
});

setView(VIEWS.includes(ui.view) ? ui.view : 'overview');
render();
checkHash();

ZL.tour([
  { el: '#group-btn', title: 'Your groups', body: 'Each trip, share house or dinner club is its own group. Switch between them, rename one or start a new one here.', before: () => { if (ui.view === 'editor') closeEditor(); } },
  { el: '#people-panel', title: 'Add your people', body: 'Add everyone who shares costs and rename them any time. Someone can only be removed once they are out of every expense.', before: () => setView('people') },
  { el: '#add-btn', title: 'Log an expense', body: 'Add what was paid, who paid, the date and a category. Tap any expense in Activity later to edit it.', before: () => setView('overview') },
  { el: '#e-mode', title: 'Four ways to split', body: 'Equal, exact amounts, shares, or itemised from the receipt, where tax and tip follow what each person ordered.', before: () => openEditor(null, { tour: true }) },
  { el: '#card-donut', title: 'Balances and spending', body: 'The total, each person’s share, and where the money went by category. Hover or tap a slice for its value. Balances sit just below.', before: () => { if (ui.view === 'editor') closeEditor(); else setView('overview'); } },
  { el: '#card-settle', title: 'Settle up', body: 'The fewest payments that clear every balance. Tap Mark as paid as money changes hands and the balances update.', before: () => { if (ui.view !== 'overview') setView('overview'); } },
  { el: '#share-btn', title: 'Share and export', body: 'Send the whole group as a link, copy a summary for the group chat, or export a CSV.' },
]);

window.SplitApp = { get state() { return state; }, render, loadExample };
})();
