// Split It: pure money logic. Everything works in integer minor units (cents),
// so totals always match exactly and there is no floating point drift.
// No DOM access here, so it can be tested on its own.
(function (global) {
'use strict';

const CURRENCIES = [
  { code: 'AUD', digits: 2, name: 'Australian dollar' },
  { code: 'NZD', digits: 2, name: 'New Zealand dollar' },
  { code: 'USD', digits: 2, name: 'US dollar' },
  { code: 'EUR', digits: 2, name: 'Euro' },
  { code: 'GBP', digits: 2, name: 'British pound' },
  { code: 'IDR', digits: 0, name: 'Indonesian rupiah' },
  { code: 'JPY', digits: 0, name: 'Japanese yen' },
];

const CATEGORIES = [
  { id: 'food', label: 'Food & drink' },
  { id: 'groceries', label: 'Groceries' },
  { id: 'rent', label: 'Rent' },
  { id: 'transport', label: 'Transport' },
  { id: 'accommodation', label: 'Accommodation' },
  { id: 'activities', label: 'Activities' },
  { id: 'bills', label: 'Bills' },
  { id: 'other', label: 'Other' },
];
const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const categoryLabel = (id) => (CATEGORIES.find((c) => c.id === id) || { label: 'Other' }).label;

const MODES = ['equal', 'exact', 'shares', 'items'];
const MODE_LABELS = { equal: 'Equal', exact: 'Exact amounts', shares: 'Shares', items: 'Itemised' };

const DIGITS = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.digits]));
const digitsFor = (code) => DIGITS[code] ?? 2;

const MAX_MINOR = 99_999_999_999; // about 1 billion dollars, well inside safe integers

/** Parse user text like "42.5", "$1,234.56" or "Rp 150000" into integer minor units.
 *  Returns { value } or { error } with a message that says how to fix it.
 *  allowZero lets itemised line items be free. */
function parseAmount(input, code = 'AUD', { allowZero = false } = {}) {
  const digits = digitsFor(code);
  const s = String(input ?? '').trim().replace(/[\s,]/g, '').replace(/^[^\d.]+/, '');
  if (s === '') return { error: 'Enter an amount, like 42.50.' };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return { error: 'Enter the amount as a number, like 42.50.' };
  const whole = m[1] || '0';
  const frac = m[2] || '';
  if (frac.length > digits) {
    return { error: digits === 0 ? `${code} has no cents. Enter a whole number.` : `Use at most ${digits} decimal places.` };
  }
  const value = Number(whole) * 10 ** digits + Number((frac + '0'.repeat(digits)).slice(0, digits) || 0);
  if (!Number.isSafeInteger(value) || value > MAX_MINOR) return { error: 'That amount is too large.' };
  if (value < 0 || (value === 0 && !allowZero)) return { error: 'The amount must be more than zero.' };
  return { value };
}

/** Minor units back to a plain input string, e.g. 4250 -> "42.50". */
function toInputAmount(minor, code = 'AUD') {
  const d = digitsFor(code);
  if (d === 0) return String(minor);
  const s = String(Math.abs(minor)).padStart(d + 1, '0');
  return `${minor < 0 ? '-' : ''}${s.slice(0, -d)}.${s.slice(-d)}`;
}

const fmtCache = new Map();
function formatter(code, compact) {
  const key = code + (compact ? ':c' : '');
  if (!fmtCache.has(key)) {
    const d = compact ? 0 : digitsFor(code);
    fmtCache.set(key, new Intl.NumberFormat('en-AU', {
      style: 'currency', currency: code, minimumFractionDigits: d, maximumFractionDigits: d,
    }));
  }
  return fmtCache.get(key);
}

/** Format minor units for display. signed: prefix + for positive amounts.
 *  compact: drop cents (used for chart labels). */
function formatMoney(minor, code = 'AUD', { signed = false, ascii = false, compact = false } = {}) {
  const text = formatter(code, compact).format(Math.abs(minor) / 10 ** digitsFor(code));
  if (minor < 0) return (ascii ? '-' : '−') + text;
  if (signed && minor > 0) return '+' + text;
  return text;
}

/** Parse a share weight ("1", "1.5"). Returns hundredths as an integer, or NaN. */
function parseShare(input) {
  const s = String(input ?? '').trim();
  if (s === '') return 0;
  const m = /^(\d{0,4})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return NaN;
  return Number(m[1] || 0) * 100 + Number(((m[2] || '') + '00').slice(0, 2));
}

/** Parse a percentage ("10", "12.5") into basis points (hundredths of a percent). '' is 0. NaN if invalid. */
function parsePercent(input) {
  const s = String(input ?? '').trim().replace(/%$/, '').trim();
  if (s === '') return 0;
  const m = /^(\d{0,3})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return NaN;
  const bp = Number(m[1] || 0) * 100 + Number(((m[2] || '') + '00').slice(0, 2));
  return bp > 10000 ? NaN : bp;
}
const formatPercent = (bp) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace(/0$/, ''));

/** Percentage of an amount, rounded half up, exact integer maths. */
function percentOf(minor, bp) {
  return Number((BigInt(minor) * BigInt(bp) + 5000n) / 10000n);
}

/** Split amount equally between ids. Leftover units go one at a time in ids order. */
function splitEqual(amount, ids) {
  const out = {};
  if (!ids.length) return out;
  const base = Math.floor(amount / ids.length);
  const remainder = amount - base * ids.length;
  ids.forEach((id, i) => { out[id] = base + (i < remainder ? 1 : 0); });
  return out;
}

/** Split amount in proportion to integer weights (largest remainder, ties in ids order).
 *  Always sums exactly to amount. Falls back to an equal split if all weights are zero. */
function allocate(amount, ids, weights) {
  const w = ids.map((id) => BigInt(Math.max(0, Math.round(weights[id] || 0))));
  const total = w.reduce((a, b) => a + b, 0n);
  if (total === 0n) return splitEqual(amount, ids);
  const out = {};
  const big = BigInt(amount);
  let given = 0;
  const rems = ids.map((id, i) => {
    const num = big * w[i];
    const q = Number(num / total);
    out[id] = q;
    given += q;
    return { id, i, r: num % total };
  });
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; k < amount - given; k++) out[rems[k % rems.length].id] += 1;
  return out;
}

/** Itemised receipt maths. Each line item is split equally between the people on it.
 *  Tax and tip are percentages of the item subtotal, and each is shared in proportion
 *  to what each person ordered, so every column sums exactly. */
function itemBreakdown(expense, order) {
  const items = Array.isArray(expense.items) ? expense.items : [];
  const itemsBy = {};
  let subtotal = 0;
  let unassigned = 0;
  const involved = new Set();
  for (const it of items) {
    const amt = it.amount || 0;
    subtotal += amt;
    const ids = order.filter((id) => (it.people || []).includes(id));
    if (!ids.length) { unassigned += amt; continue; }
    ids.forEach((id) => involved.add(id));
    const sp = splitEqual(amt, ids);
    for (const id of ids) itemsBy[id] = (itemsBy[id] || 0) + sp[id];
  }
  const ids = order.filter((id) => involved.has(id));
  const tax = percentOf(subtotal, expense.taxPct || 0);
  const tip = percentOf(subtotal, expense.tipPct || 0);
  const taxBy = allocate(tax, ids, itemsBy);
  const tipBy = allocate(tip, ids, itemsBy);
  const people = {};
  for (const id of ids) {
    const a = itemsBy[id] || 0, t = taxBy[id] || 0, p = tipBy[id] || 0;
    people[id] = { items: a, tax: t, tip: p, total: a + t + p };
  }
  return { subtotal, tax, tip, total: subtotal + tax + tip, unassigned, ids, people };
}

/** Work out how much each participant owes for one expense, in minor units.
 *  The result always sums exactly to expense.amount. */
function splitExpense(expense, order) {
  const amount = expense.amount;

  if (expense.mode === 'items') {
    const b = itemBreakdown(expense, order);
    if (b.ids.length) {
      if (b.unassigned === 0 && b.total === amount) {
        const out = {};
        for (const id of b.ids) out[id] = b.people[id].total;
        return out;
      }
      // Receipt does not add up (old or corrupt data): share the amount in proportion to items.
      return allocate(amount, b.ids, Object.fromEntries(b.ids.map((id) => [id, b.people[id].items])));
    }
  }

  const participants = order.filter((id) => (expense.participants || []).includes(id));
  if (!participants.length) return {};

  if (expense.mode === 'exact') {
    let sum = 0;
    for (const id of participants) sum += expense.exact?.[id] ?? 0;
    if (sum === amount) {
      const out = {};
      for (const id of participants) out[id] = expense.exact?.[id] ?? 0;
      return out;
    }
    // Corrupt data: fall through to an equal split so balances still sum to zero.
  }

  if (expense.mode === 'shares') {
    const weights = Object.fromEntries(participants.map((id) => [id, expense.shares?.[id] ?? 100]));
    if (participants.some((id) => weights[id] > 0)) return allocate(amount, participants, weights);
  }

  return splitEqual(amount, participants);
}

/** Currencies that appear in a group's expenses, most-used first (ties: oldest first). */
function currenciesUsed(group) {
  const count = new Map();
  for (let i = group.expenses.length - 1; i >= 0; i--) {
    const c = group.expenses[i].currency;
    count.set(c, (count.get(c) || 0) + 1);
  }
  const seen = [...count.keys()].sort((a, b) => count.get(b) - count.get(a));
  return seen.length ? seen : [group.currency || 'AUD'];
}

/** Net balance per person for one currency. Positive = is owed money, negative = owes.
 *  Payments (kind 'payment') move balances but do not count as spending. */
function computeBalances(group, currency) {
  const order = group.people.map((p) => p.id);
  const zero = () => Object.fromEntries(order.map((id) => [id, 0]));
  const balances = zero();
  const paid = zero();
  const share = zero();
  const byCategory = {};
  let total = 0;
  let count = 0;
  for (const e of group.expenses) {
    if (e.currency !== currency || !(e.paidBy in balances)) continue;
    const parts = splitExpense(e, order);
    balances[e.paidBy] += e.amount;
    for (const [id, v] of Object.entries(parts)) if (id in balances) balances[id] -= v;
    if (e.kind !== 'payment') {
      total += e.amount;
      count += 1;
      paid[e.paidBy] += e.amount;
      for (const [id, v] of Object.entries(parts)) if (id in share) share[id] += v;
      const cat = CATEGORY_IDS.includes(e.category) ? e.category : 'other';
      byCategory[cat] = (byCategory[cat] || 0) + e.amount;
    }
  }
  return { balances, paid, share, total, count, byCategory };
}

/** Greedy: repeatedly match the largest creditor with the largest debtor.
 *  At most k - 1 transfers for k people. Ties go to whoever is earlier in order. */
function greedySettle(balances, order) {
  const people = order.map((id) => ({ id, v: balances[id] || 0 }));
  const transfers = [];
  for (let guard = 0; guard < order.length * order.length + 1; guard++) {
    let creditor = null;
    let debtor = null;
    for (const p of people) {
      if (p.v > 0 && (!creditor || p.v > creditor.v)) creditor = p;
      if (p.v < 0 && (!debtor || p.v < debtor.v)) debtor = p;
    }
    if (!creditor || !debtor) break;
    const amount = Math.min(creditor.v, -debtor.v);
    transfers.push({ from: debtor.id, to: creditor.id, amount });
    creditor.v -= amount;
    debtor.v += amount;
  }
  return transfers;
}

/** Fewest transfers that clear every balance.
 *  The minimum is (people with a balance) − (the most groups that each sum to zero), because
 *  each zero-sum group can settle internally in size − 1 payments. A bitmask DP over subsets
 *  finds that maximum exactly for up to 16 people with a balance; larger groups fall back to greedy. */
function settleUp(balances, order) {
  const nz = order.filter((id) => (balances[id] || 0) !== 0);
  if (nz.length === 0) return [];
  if (nz.length > 16) return greedySettle(balances, nz);
  const n = nz.length;
  const v = nz.map((id) => balances[id]);
  const N = 1 << n;
  const sum = new Float64Array(N);
  const dp = new Int8Array(N);
  for (let mask = 1; mask < N; mask++) {
    const low = mask & -mask;
    sum[mask] = sum[mask ^ low] + v[31 - Math.clz32(low)];
    let best = 0;
    for (let j = 0; j < n; j++) if (mask & (1 << j)) { const d = dp[mask ^ (1 << j)]; if (d > best) best = d; }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
  }
  // Walk back from the full set, removing one person at a time along an optimal chain.
  const removal = [];
  let cur = N - 1;
  while (cur) {
    const target = dp[cur] - (sum[cur] === 0 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      if ((cur & (1 << j)) && dp[cur ^ (1 << j)] === target) { removal.push(j); cur ^= 1 << j; break; }
    }
  }
  // Adding people back in reverse order, every time the running sum hits zero closes a group.
  const transfers = [];
  let acc = 0;
  let grp = [];
  for (let k = removal.length - 1; k >= 0; k--) {
    const j = removal[k];
    grp.push(j);
    acc += v[j];
    if (acc === 0) {
      const ids = nz.filter((_, idx) => grp.includes(idx));
      transfers.push(...greedySettle(balances, ids));
      grp = [];
    }
  }
  if (grp.length) transfers.push(...greedySettle(balances, nz.filter((_, idx) => grp.includes(idx))));
  return transfers.sort((a, b) => b.amount - a.amount || order.indexOf(a.from) - order.indexOf(b.from));
}

/** Expenses that match a search and filters, newest first. */
function normal(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function filterExpenses(group, { q = '', person = '', category = '' } = {}) {
  const name = (id) => group.people.find((p) => p.id === id)?.name ?? '';
  const terms = normal(q).split(/\s+/).filter(Boolean);
  return group.expenses.filter((e) => {
    if (person && e.paidBy !== person && !(e.participants || []).includes(person)) return false;
    if (category === 'payment') { if (e.kind !== 'payment') return false; }
    else if (category && (e.kind === 'payment' || e.category !== category)) return false;
    if (!terms.length) return true;
    const hay = normal([e.desc, e.notes, e.kind === 'payment' ? 'settlement payment' : categoryLabel(e.category), name(e.paidBy),
      ...(e.participants || []).map(name), ...(e.items || []).map((i) => i.name)].join(' '));
    return terms.every((t) => hay.includes(t));
  }).sort((a, b) => (a.date === b.date ? (b.created || 0) - (a.created || 0) : a.date < b.date ? 1 : -1));
}

/** Plain-text settle-up summary for pasting into a group chat. */
function summaryText(group) {
  const name = (id) => group.people.find((p) => p.id === id)?.name ?? 'Someone';
  const order = group.people.map((p) => p.id);
  const lines = [`${group.name}: settle up`];
  for (const cur of currenciesUsed(group)) {
    const { balances, total, share } = computeBalances(group, cur);
    const transfers = settleUp(balances, order);
    lines.push('', `Total spent: ${formatMoney(total, cur, { ascii: true })} (${cur})`);
    for (const id of order) {
      const b = balances[id];
      lines.push(`- ${name(id)}: share ${formatMoney(share[id], cur, { ascii: true })}, ${b > 0 ? 'gets back ' + formatMoney(b, cur, { ascii: true }) : b < 0 ? 'owes ' + formatMoney(-b, cur, { ascii: true }) : 'square'}`);
    }
    lines.push('');
    if (!transfers.length) lines.push('Everyone is square.');
    else lines.push(transfers.length === 1 ? '1 payment to settle up:' : `${transfers.length} payments to settle up:`);
    for (const t of transfers) lines.push(`${name(t.from)} pays ${name(t.to)} ${formatMoney(t.amount, cur, { ascii: true })}`);
  }
  lines.push('', 'Worked out with Split It, https://lz-split-it.pages.dev/');
  return lines.join('\n');
}

/** CSV with one row per expense or payment and one column per person showing their share. */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheets running it as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(group) {
  const order = group.people.map((p) => p.id);
  const name = (id) => group.people.find((p) => p.id === id)?.name ?? '';
  const rows = [['Date', 'Type', 'Description', 'Category', 'Paid by', 'Amount', 'Currency', 'Split', ...group.people.map((p) => p.name), 'Notes']];
  const list = [...group.expenses].sort((a, b) => (a.date === b.date ? (a.created || 0) - (b.created || 0) : a.date < b.date ? -1 : 1));
  for (const e of list) {
    const parts = splitExpense(e, order);
    const pay = e.kind === 'payment';
    rows.push([
      e.date, pay ? 'Payment' : 'Expense', e.desc, pay ? '' : categoryLabel(e.category), name(e.paidBy),
      toInputAmount(e.amount, e.currency), e.currency, pay ? 'Payment to ' + name((e.participants || [])[0]) : MODE_LABELS[e.mode] || 'Equal',
      ...order.map((id) => (parts[id] ? toInputAmount(parts[id], e.currency) : '')), e.notes || '',
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/* ---------- Share links ---------- */
function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
function packGroup(g) {
  return { v: 2, name: g.name, emoji: g.emoji || '', color: g.color || '', currency: g.currency, people: g.people, expenses: g.expenses };
}
/** Group -> URL-safe string. 'd.' = deflate-raw compressed JSON, 'j.' = plain JSON (no CompressionStream). */
async function encodeShare(group, { compress = true } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(packGroup(group)));
  if (compress && typeof CompressionStream === 'function') {
    try { return 'd.' + bytesToB64url(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch (e) { /* fall back */ }
  }
  return 'j.' + bytesToB64url(bytes);
}
/** URL string -> sanitised group (without an id), or null if it is damaged. */
async function decodeShare(str) {
  try {
    const s = String(str || '').trim();
    let bytes;
    if (s.startsWith('d.')) {
      if (typeof DecompressionStream !== 'function') return null;
      bytes = await pipe(b64urlToBytes(s.slice(2)), new DecompressionStream('deflate-raw'));
    } else if (s.startsWith('j.')) bytes = b64urlToBytes(s.slice(2));
    else return null;
    return sanitizeGroup(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) { return null; }
}

const COLORS = ['green', 'blue', 'indigo', 'purple', 'pink', 'orange', 'teal', 'graphite'];
const isId = (s) => typeof s === 'string' && /^[\w-]{1,40}$/.test(s);
const isInt = (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_MINOR;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/** Validate and clean a group from storage or a share link. Returns null if unusable. */
function sanitizeGroup(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.people) || !Array.isArray(raw.expenses)) return null;
  if (raw.people.length > 60 || raw.expenses.length > 5000) return null;
  const people = [];
  const seen = new Set();
  for (const p of raw.people) {
    if (!p || !isId(p.id) || seen.has(p.id)) return null;
    const nm = clip(p.name, 40);
    if (!nm) return null;
    seen.add(p.id);
    people.push({ id: p.id, name: nm });
  }
  const cur = (c) => (c in DIGITS ? c : null);
  const expenses = [];
  for (const e of raw.expenses) {
    if (!e || !isInt(e.amount) || e.amount === 0 || !cur(e.currency) || !seen.has(e.paidBy)) return null;
    const participants = (Array.isArray(e.participants) ? e.participants : []).filter((id) => seen.has(id));
    const kind = e.kind === 'payment' ? 'payment' : 'expense';
    const mode = kind === 'payment' ? 'equal' : MODES.includes(e.mode) ? e.mode : 'equal';
    const out = {
      id: isId(e.id) ? e.id : Math.random().toString(36).slice(2, 12), kind,
      desc: clip(e.desc, 80) || (kind === 'payment' ? 'Payment' : 'Expense'), amount: e.amount, currency: e.currency,
      date: /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : new Date().toISOString().slice(0, 10),
      category: kind === 'payment' ? null : CATEGORY_IDS.includes(e.category) ? e.category : 'other',
      paidBy: e.paidBy, participants, mode, notes: clip(e.notes, 500), created: Number.isSafeInteger(e.created) ? e.created : 0,
    };
    if (mode === 'exact') out.exact = Object.fromEntries(participants.map((id) => [id, isInt(e.exact?.[id]) ? e.exact[id] : 0]));
    if (mode === 'shares') out.shares = Object.fromEntries(participants.map((id) => [id, isInt(e.shares?.[id]) ? e.shares[id] : 100]));
    if (mode === 'items') {
      if (!Array.isArray(e.items) || e.items.length > 200) return null;
      out.items = e.items.map((it) => ({ id: isId(it?.id) ? it.id : Math.random().toString(36).slice(2, 10), name: clip(it?.name, 60),
        amount: isInt(it?.amount) ? it.amount : 0, people: (Array.isArray(it?.people) ? it.people : []).filter((id) => seen.has(id)) }));
      out.taxPct = Number.isInteger(e.taxPct) && e.taxPct >= 0 && e.taxPct <= 10000 ? e.taxPct : 0;
      out.tipPct = Number.isInteger(e.tipPct) && e.tipPct >= 0 && e.tipPct <= 10000 ? e.tipPct : 0;
      out.participants = itemBreakdown(out, people.map((p) => p.id)).ids;
    }
    if (!out.participants.length) return null;
    expenses.push(out);
  }
  return {
    name: clip(raw.name, 40) || 'Shared group',
    emoji: typeof raw.emoji === 'string' ? [...raw.emoji].slice(0, 2).join('') : '',
    color: COLORS.includes(raw.color) ? raw.color : 'green',
    currency: cur(raw.currency) || 'AUD', people, expenses,
  };
}

/** Pick a likely category from a description ("Taxi to airport" -> transport). */
const GUESS = [
  ['groceries', /\b(grocer|supermarket|coles|woolies|woolworths|aldi|iga|pepito|market|groceries)\b/],
  ['rent', /\b(rent|bond|lease)\b/],
  ['accommodation', /\b(hotel|villa|airbnb|hostel|motel|resort|accommodation|stay|lodge)\b/],
  ['transport', /\b(taxi|uber|grab|bolt|bus|train|fuel|petrol|parking|flight|flights|scooter|car|ferry|transfer|driver|toll|tolls)\b/],
  ['bills', /\b(power|electricity|gas bill|water|internet|wifi|nbn|phone|sim|bill|bills|insurance|netflix|spotify|subscription)\b/],
  ['activities', /\b(tickets?|tour|trek|surf|lesson|lessons|spa|massage|museum|cinema|movie|concert|dive|diving|snorkel|park|entry|class)\b/],
  ['food', /\b(dinner|lunch|breakfast|brunch|coffee|cafe|restaurant|pizza|drinks|beer|bar|cocktails?|takeaway|warung|food|snacks|burger|sushi|ramen|bbq)\b/],
];
function guessCategory(desc) {
  const d = normal(desc);
  for (const [id, re] of GUESS) if (re.test(d)) return id;
  return null;
}

global.SplitLogic = {
  CURRENCIES, CATEGORIES, CATEGORY_IDS, MODES, MODE_LABELS, COLORS, digitsFor, categoryLabel,
  parseAmount, toInputAmount, formatMoney, parseShare, parsePercent, formatPercent, percentOf,
  splitEqual, allocate, itemBreakdown, splitExpense, currenciesUsed, computeBalances, greedySettle, settleUp,
  filterExpenses, summaryText, toCSV, encodeShare, decodeShare, sanitizeGroup, guessCategory,
};
})(typeof window !== 'undefined' ? window : globalThis);
