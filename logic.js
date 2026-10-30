// Split It: pure money logic. Everything works in integer minor units (cents),
// so totals always match exactly and there is no floating point drift.
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

const DIGITS = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.digits]));
const digitsFor = (code) => DIGITS[code] ?? 2;

const MAX_MINOR = 99_999_999_999; // about 1 billion dollars, well inside safe integers

/** Parse user text like "42.5", "$1,234.56" or "Rp 150000" into integer minor units.
 *  Returns { value } or { error } with a message that says how to fix it. */
function parseAmount(input, code = 'AUD') {
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
  if (value <= 0) return { error: 'The amount must be more than zero.' };
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
function formatter(code) {
  if (!fmtCache.has(code)) {
    const d = digitsFor(code);
    fmtCache.set(code, new Intl.NumberFormat('en-AU', {
      style: 'currency', currency: code, minimumFractionDigits: d, maximumFractionDigits: d,
    }));
  }
  return fmtCache.get(code);
}

/** Format minor units for display. signed: prefix + for positive amounts. */
function formatMoney(minor, code = 'AUD', { signed = false, ascii = false } = {}) {
  const text = formatter(code).format(Math.abs(minor) / 10 ** digitsFor(code));
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

/** Work out how much each participant owes for one expense, in minor units.
 *  The result always sums exactly to expense.amount.
 *  Leftover cents are handed out one at a time in the group's people order
 *  (equal split) or by largest remainder, ties in people order (shares). */
function splitExpense(expense, order) {
  const participants = order.filter((id) => expense.participants.includes(id));
  const out = {};
  const amount = expense.amount;
  if (!participants.length) return out;

  if (expense.mode === 'exact') {
    let sum = 0;
    for (const id of participants) sum += expense.exact?.[id] ?? 0;
    if (sum === amount) {
      for (const id of participants) out[id] = expense.exact?.[id] ?? 0;
      return out;
    }
    // Corrupt data: fall through to an equal split so balances still sum to zero.
  }

  if (expense.mode === 'shares') {
    const weights = participants.map((id) => BigInt(Math.max(0, expense.shares?.[id] ?? 100)));
    const total = weights.reduce((a, b) => a + b, 0n);
    if (total > 0n) {
      const big = BigInt(amount);
      let given = 0;
      const rems = participants.map((id, i) => {
        const num = big * weights[i];
        const q = Number(num / total);
        out[id] = q;
        given += q;
        return { id, i, r: num % total };
      });
      rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
      for (let k = 0; k < amount - given; k++) out[rems[k].id] += 1;
      return out;
    }
  }

  const base = Math.floor(amount / participants.length);
  const remainder = amount - base * participants.length;
  participants.forEach((id, i) => { out[id] = base + (i < remainder ? 1 : 0); });
  return out;
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

/** Net balance per person for one currency. Positive = is owed money, negative = owes. */
function computeBalances(group, currency) {
  const order = group.people.map((p) => p.id);
  const zero = () => Object.fromEntries(order.map((id) => [id, 0]));
  const balances = zero();
  const paid = zero();
  const share = zero();
  let total = 0;
  for (const e of group.expenses) {
    if (e.currency !== currency || !(e.paidBy in balances)) continue;
    const parts = splitExpense(e, order);
    balances[e.paidBy] += e.amount;
    for (const [id, v] of Object.entries(parts)) balances[id] -= v;
    if (e.kind !== 'payment') {
      total += e.amount;
      paid[e.paidBy] += e.amount;
      for (const [id, v] of Object.entries(parts)) share[id] += v;
    }
  }
  return { balances, paid, share, total };
}

/** Greedy settle-up: repeatedly match the largest creditor with the largest debtor.
 *  Produces at most n - 1 transfers. Ties go to whoever is earlier in people order. */
function settleUp(balances, order) {
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

/** Plain-text settle-up summary for pasting into a group chat. */
function summaryText(group) {
  const name = (id) => group.people.find((p) => p.id === id)?.name ?? 'Someone';
  const lines = [`${group.name}: settle up`];
  for (const cur of currenciesUsed(group)) {
    const { balances, total } = computeBalances(group, cur);
    const transfers = settleUp(balances, group.people.map((p) => p.id));
    lines.push('', `Total spent: ${formatMoney(total, cur, { ascii: true })} (${cur})`);
    if (!transfers.length) lines.push('Everyone is square.');
    for (const t of transfers) lines.push(`${name(t.from)} pays ${name(t.to)} ${formatMoney(t.amount, cur, { ascii: true })}`);
  }
  lines.push('', 'Worked out with Split It');
  return lines.join('\n');
}

global.SplitLogic = { CURRENCIES, digitsFor, parseAmount, toInputAmount, formatMoney, parseShare, splitExpense, currenciesUsed, computeBalances, settleUp, summaryText };
})(typeof window !== 'undefined' ? window : globalThis);
