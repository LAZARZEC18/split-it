(function () {
  'use strict';
  const L = window.SplitLogic;
  const STORE_KEY = 'split-it:v1';
  const THEME_KEY = 'split-it:theme';

  const $ = (sel) => document.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

  // ---------- State ----------
  function blankGroup(name) {
    return { id: uid(), name, currency: 'AUD', people: [], expenses: [] };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.groups) && s.groups.length) {
          if (!s.groups.some((g) => g.id === s.activeId)) s.activeId = s.groups[0].id;
          return s;
        }
      }
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    const g = blankGroup('House');
    return { version: 1, activeId: g.id, groups: [g] };
  }
  let state = load();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: keep working in memory */ }
  }
  const group = () => state.groups.find((g) => g.id === state.activeId);
  const personName = (id) => group().people.find((p) => p.id === id)?.name ?? 'Someone';

  // UI-only state
  let editingId = null;
  let viewCurrency = null;
  const draft = { exact: {}, shares: {} };

  // ---------- Theme ----------
  const themeBtn = $('#theme-toggle');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  function currentTheme() {
    return document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');
  }
  function syncThemeUi() {
    const t = currentTheme();
    themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    $('#theme-color').setAttribute('content', t === 'dark' ? '#0F161D' : '#F3F5F7');
  }
  themeBtn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    syncThemeUi();
  });
  systemDark.addEventListener?.('change', syncThemeUi);
  syncThemeUi();

  // ---------- Toast ----------
  const toast = $('#toast');
  let toastTimer;
  function showToast(msg, action) {
    toast.innerHTML = '';
    toast.append(document.createTextNode(msg));
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action';
      b.textContent = action.label;
      b.addEventListener('click', () => { action.run(); hideToast(); });
      toast.append(b);
    }
    toast.classList.add('show');
    toast.style.pointerEvents = action ? 'auto' : 'none';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 6000 : 2400);
  }
  function hideToast() { toast.classList.remove('show'); toast.style.pointerEvents = 'none'; }

  // ---------- Groups ----------
  function renderGroups() {
    const list = $('#group-list');
    list.innerHTML = state.groups.map((g) =>
      `<button type="button" class="group-tab" data-id="${g.id}" aria-current="${g.id === state.activeId}">${esc(g.name || 'Untitled group')}</button>`
    ).join('');
  }
  $('#group-list').addEventListener('click', (e) => {
    const b = e.target.closest('.group-tab');
    if (!b || b.dataset.id === state.activeId) return;
    state.activeId = b.dataset.id;
    editingId = null; viewCurrency = null;
    save(); resetForm(); renderAll();
  });
  const newGroupForm = $('#new-group-form');
  function toggleNewGroup(open) {
    newGroupForm.hidden = !open;
    $('#new-group-btn').setAttribute('aria-expanded', String(open));
    if (open) $('#new-group-name').focus();
  }
  $('#new-group-btn').addEventListener('click', () => toggleNewGroup(newGroupForm.hidden));
  $('#new-group-cancel').addEventListener('click', () => toggleNewGroup(false));
  newGroupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#new-group-name');
    const name = input.value.trim() || `Group ${state.groups.length + 1}`;
    const g = blankGroup(name);
    state.groups.push(g);
    state.activeId = g.id;
    input.value = '';
    toggleNewGroup(false);
    editingId = null; viewCurrency = null;
    save(); resetForm(); renderAll();
    $('#person-name').focus();
  });
  $('#group-name').addEventListener('input', (e) => {
    group().name = e.target.value;
    save(); renderGroups();
  });
  $('#group-name').addEventListener('blur', (e) => {
    if (!e.target.value.trim()) { group().name = 'Untitled group'; e.target.value = group().name; save(); renderGroups(); }
  });
  $('#delete-group-btn').addEventListener('click', () => {
    const g = group();
    const idx = state.groups.indexOf(g);
    state.groups.splice(idx, 1);
    let placeholder = null;
    if (!state.groups.length) { placeholder = blankGroup('House'); state.groups.push(placeholder); }
    state.activeId = state.groups[Math.max(0, idx - 1)].id;
    editingId = null; viewCurrency = null;
    save(); resetForm(); renderAll();
    showToast(`Deleted ${g.name}.`, {
      label: 'Undo',
      run: () => {
        if (placeholder && !placeholder.people.length && !placeholder.expenses.length) {
          state.groups = state.groups.filter((x) => x !== placeholder);
        }
        state.groups.splice(Math.min(idx, state.groups.length), 0, g);
        state.activeId = g.id;
        save(); resetForm(); renderAll();
      },
    });
  });

  // ---------- People ----------
  function renderPeople() {
    const g = group();
    $('#people-list').innerHTML = g.people.length
      ? g.people.map((p) => `
        <li class="person">
          <span class="avatar" aria-hidden="true">${esc(initials(p.name))}</span>
          <span class="person-name">${esc(p.name)}</span>
          <button type="button" class="remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">
            <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8"/></svg>
          </button>
        </li>`).join('')
      : `<li class="empty">No one here yet. Add the people you share costs with.</li>`;
  }
  $('#person-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#person-name');
    const err = $('#people-error');
    const name = input.value.trim().replace(/\s+/g, ' ');
    const g = group();
    if (!name) { err.textContent = 'Type a name first.'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    if (g.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      err.textContent = `${name} is already in this group. Use a different name, like ${name} B.`;
      input.setAttribute('aria-invalid', 'true'); input.focus(); return;
    }
    err.textContent = ''; input.removeAttribute('aria-invalid');
    const p = { id: uid(), name };
    g.people.push(p);
    input.value = '';
    // New people join new expenses by default
    if (!editingId) formParticipants.add(p.id);
    save(); renderAll();
    input.focus();
  });
  $('#person-name').addEventListener('input', () => { $('#people-error').textContent = ''; $('#person-name').removeAttribute('aria-invalid'); });
  $('#people-list').addEventListener('click', (e) => {
    const b = e.target.closest('.remove');
    if (!b) return;
    const g = group();
    const id = b.dataset.id;
    const p = g.people.find((x) => x.id === id);
    const used = g.expenses.filter((x) => x.paidBy === id || x.participants.includes(id)).length;
    if (used) {
      $('#people-error').textContent = `${p.name} is part of ${used} expense${used > 1 ? 's' : ''}. Edit or delete those first, then remove them.`;
      return;
    }
    $('#people-error').textContent = '';
    g.people = g.people.filter((x) => x.id !== id);
    formParticipants.delete(id);
    save(); renderAll();
  });

  // ---------- Expense form ----------
  const form = $('#expense-form');
  const descIn = $('#exp-desc');
  const amountIn = $('#exp-amount');
  const curIn = $('#exp-currency');
  const paidIn = $('#exp-paid');
  const formErr = $('#form-error');
  let formParticipants = new Set(group().people.map((p) => p.id));
  let formMode = 'equal';

  curIn.innerHTML = L.CURRENCIES.map((c) => `<option value="${c.code}">${c.code}</option>`).join('');

  function renderFormOptions() {
    const g = group();
    const hasPeople = g.people.length > 0;
    form.hidden = !hasPeople;
    $('#form-empty').hidden = hasPeople;
    const prevPaid = paidIn.value;
    paidIn.innerHTML = g.people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (g.people.some((p) => p.id === prevPaid)) paidIn.value = prevPaid;
    for (const id of [...formParticipants]) if (!g.people.some((p) => p.id === id)) formParticipants.delete(id);
    $('#exp-participants').innerHTML = g.people.map((p) => `
      <label class="chip"><input type="checkbox" value="${p.id}" ${formParticipants.has(p.id) ? 'checked' : ''}><span>${esc(p.name)}</span></label>`).join('');
    renderSplitDetail();
  }

  function selectedParticipants() {
    return group().people.map((p) => p.id).filter((id) => formParticipants.has(id));
  }

  function exactValue(id) {
    const raw = (draft.exact[id] ?? '').trim();
    if (raw === '' || /^0*(\.0*)?$/.test(raw)) return { value: 0 };
    return L.parseAmount(raw, curIn.value);
  }

  function renderSplitDetail() {
    const box = $('#split-detail');
    const ids = selectedParticipants();
    const cur = curIn.value;
    const amt = L.parseAmount(amountIn.value, cur);
    const total = amt.value || 0;
    if (!ids.length) { box.innerHTML = ''; return; }

    if (formMode === 'equal') {
      if (!total) { box.innerHTML = `<p class="split-status">Each person's share appears here once you enter an amount.</p>`; return; }
      const parts = L.splitExpense({ amount: total, participants: ids, mode: 'equal' }, ids);
      const values = ids.map((id) => parts[id]);
      const same = values.every((v) => v === values[0]);
      box.innerHTML = `<p class="split-status">${same
        ? `${L.formatMoney(values[0], cur)} each`
        : ids.map((id) => `${esc(personName(id))} ${L.formatMoney(parts[id], cur)}`).join(', ') + '. Leftover cents go to the first people listed.'}</p>`;
      return;
    }

    const rows = ids.map((id) => {
      const name = esc(personName(id));
      if (formMode === 'exact') {
        return `<div class="split-row"><label for="x-${id}">${name}</label>
          <input type="text" inputmode="decimal" id="x-${id}" data-id="${id}" data-kind="exact" placeholder="0.00" value="${esc(draft.exact[id] ?? '')}" autocomplete="off"></div>`;
      }
      return `<div class="split-row"><label for="s-${id}">${name}<span class="preview" data-preview="${id}"></span></label>
        <input type="text" inputmode="decimal" id="s-${id}" data-id="${id}" data-kind="shares" value="${esc(draft.shares[id] ?? '1')}" autocomplete="off" aria-describedby="share-help"></div>`;
    }).join('');
    const help = formMode === 'shares'
      ? `<p class="split-status" id="share-help">Shares are weights. Someone with 2 pays twice as much as someone with 1.</p>` : '';
    box.innerHTML = `${help}<div class="split-rows">${rows}</div><p class="split-status" id="split-status"></p>`;
    updateSplitStatus();
  }

  function updateSplitStatus() {
    const status = $('#split-status');
    if (!status) return;
    const ids = selectedParticipants();
    const cur = curIn.value;
    const total = L.parseAmount(amountIn.value, cur).value || 0;
    status.className = 'split-status';
    if (formMode === 'exact') {
      let sum = 0; let bad = false;
      for (const id of ids) { const r = exactValue(id); if (r.error) bad = true; else sum += r.value; }
      if (bad) { status.textContent = 'One of the amounts is not a valid number.'; status.classList.add('bad'); return; }
      const left = total - sum;
      if (!total) status.textContent = `Assigned ${L.formatMoney(sum, cur)} so far. Enter the total amount above.`;
      else if (left === 0) { status.textContent = `All ${L.formatMoney(total, cur)} assigned.`; status.classList.add('ok'); }
      else if (left > 0) status.textContent = `${L.formatMoney(left, cur)} left to assign of ${L.formatMoney(total, cur)}.`;
      else { status.textContent = `${L.formatMoney(-left, cur)} over the total of ${L.formatMoney(total, cur)}.`; status.classList.add('bad'); }
    } else if (formMode === 'shares') {
      const shares = {};
      let bad = false; let sum = 0;
      for (const id of ids) { const v = L.parseShare(draft.shares[id] ?? '1'); if (Number.isNaN(v)) bad = true; else { shares[id] = v; sum += v; } }
      document.querySelectorAll('[data-preview]').forEach((el) => { el.textContent = ''; });
      if (bad) { status.textContent = 'Shares must be numbers, like 1 or 1.5.'; status.classList.add('bad'); return; }
      if (!sum) { status.textContent = 'Give at least one person a share above zero.'; status.classList.add('bad'); return; }
      if (total) {
        const parts = L.splitExpense({ amount: total, participants: ids, mode: 'shares', shares }, ids);
        for (const id of ids) { const el = document.querySelector(`[data-preview="${id}"]`); if (el) el.textContent = L.formatMoney(parts[id], cur); }
        status.textContent = '';
      } else status.textContent = 'Enter the total amount above to see what each share costs.';
    }
  }

  $('#exp-participants').addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) formParticipants.add(e.target.value); else formParticipants.delete(e.target.value);
    formErr.textContent = '';
    renderSplitDetail();
  });
  $('#exp-mode').addEventListener('change', (e) => {
    formMode = e.target.value;
    formErr.textContent = '';
    renderSplitDetail();
  });
  $('#split-detail').addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.kind) return;
    draft[t.dataset.kind][t.dataset.id] = t.value;
    formErr.textContent = '';
    updateSplitStatus();
  });
  amountIn.addEventListener('input', () => {
    amountIn.removeAttribute('aria-invalid'); formErr.textContent = '';
    if (formMode === 'equal') renderSplitDetail(); else updateSplitStatus();
  });
  curIn.addEventListener('change', () => { if (formMode === 'equal') renderSplitDetail(); else updateSplitStatus(); });
  descIn.addEventListener('input', () => { descIn.removeAttribute('aria-invalid'); formErr.textContent = ''; });

  function fail(msg, el) {
    formErr.textContent = msg;
    if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
    return null;
  }

  function readForm() {
    const cur = curIn.value;
    const desc = descIn.value.trim();
    if (!desc) return fail('Add a short description, like Groceries.', descIn);
    const amt = L.parseAmount(amountIn.value, cur);
    if (amt.error) return fail(amt.error, amountIn);
    const ids = selectedParticipants();
    if (!ids.length) return fail('Pick at least one person to split this between.');
    const exp = { desc, amount: amt.value, currency: cur, paidBy: paidIn.value, participants: ids, mode: formMode };
    if (formMode === 'exact') {
      exp.exact = {};
      let sum = 0;
      for (const id of ids) {
        const r = exactValue(id);
        if (r.error) return fail(`${personName(id)}: ${r.error}`, document.getElementById(`x-${id}`));
        exp.exact[id] = r.value; sum += r.value;
      }
      if (sum !== amt.value) {
        const diff = amt.value - sum;
        return fail(diff > 0
          ? `The amounts add up to ${L.formatMoney(sum, cur)}. Assign the remaining ${L.formatMoney(diff, cur)} so they match the total.`
          : `The amounts add up to ${L.formatMoney(sum, cur)}, which is ${L.formatMoney(-diff, cur)} more than the total. Lower one of them.`);
      }
    } else if (formMode === 'shares') {
      exp.shares = {};
      let sum = 0;
      for (const id of ids) {
        const v = L.parseShare(draft.shares[id] ?? '1');
        if (Number.isNaN(v)) return fail(`${personName(id)}'s share must be a number, like 1 or 1.5.`, document.getElementById(`s-${id}`));
        exp.shares[id] = v; sum += v;
      }
      if (!sum) return fail('Give at least one person a share above zero.');
    }
    return exp;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const exp = readForm();
    if (!exp) return;
    const g = group();
    let flashId;
    if (editingId) {
      const old = g.expenses.find((x) => x.id === editingId);
      Object.assign(old, exp);
      delete old.exact; delete old.shares;
      if (exp.exact) old.exact = exp.exact;
      if (exp.shares) old.shares = exp.shares;
      flashId = old.id;
      showToast('Saved changes.');
    } else {
      exp.id = uid();
      exp.createdAt = Date.now();
      g.expenses.unshift(exp);
      flashId = exp.id;
    }
    g.currency = exp.currency;
    viewCurrency = exp.currency;
    save();
    resetForm();
    renderAll();
    const row = document.querySelector(`.expense[data-id="${flashId}"]`);
    row?.classList.add('flash');
    descIn.focus();
  });

  function resetForm() {
    const g = group();
    editingId = null;
    form.reset();
    formMode = 'equal';
    draft.exact = {}; draft.shares = {};
    formParticipants = new Set(g.people.map((p) => p.id));
    curIn.value = g.currency || 'AUD';
    $('#submit-btn').textContent = 'Add expense';
    $('#form-h').textContent = 'Add an expense';
    $('#cancel-edit').hidden = true;
    formErr.textContent = '';
    [descIn, amountIn].forEach((el) => el.removeAttribute('aria-invalid'));
  }
  $('#cancel-edit').addEventListener('click', () => { resetForm(); renderAll(); });

  function startEdit(id) {
    const g = group();
    const x = g.expenses.find((e) => e.id === id);
    if (!x) return;
    editingId = id;
    descIn.value = x.desc;
    curIn.value = x.currency;
    amountIn.value = L.toInputAmount(x.amount, x.currency);
    paidIn.value = x.paidBy;
    formParticipants = new Set(x.participants);
    formMode = x.mode || 'equal';
    form.querySelector(`input[name="mode"][value="${formMode}"]`).checked = true;
    draft.exact = {}; draft.shares = {};
    for (const [pid, v] of Object.entries(x.exact || {})) draft.exact[pid] = L.toInputAmount(v, x.currency);
    for (const [pid, v] of Object.entries(x.shares || {})) draft.shares[pid] = String(v / 100);
    $('#submit-btn').textContent = 'Save changes';
    $('#form-h').textContent = `Edit ${x.desc}`;
    $('#cancel-edit').hidden = false;
    renderAll();
    $('#sec-form').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    descIn.focus({ preventScroll: true });
  }

  // ---------- Expense list ----------
  function describeSplit(x) {
    const g = group();
    const n = x.participants.length;
    const everyone = n === g.people.length && n > 1;
    const who = everyone ? 'everyone' : n === 1 ? personName(x.participants[0]) : `${n} people`;
    const how = x.mode === 'exact' ? ' by exact amounts' : x.mode === 'shares' ? ' by shares' : '';
    return `${esc(personName(x.paidBy))} paid, split ${x.mode === 'equal' || !x.mode ? 'equally ' : ''}between ${esc(who)}${how}`;
  }
  function renderExpenses() {
    const g = group();
    $('#expense-list').innerHTML = g.expenses.length
      ? g.expenses.map((x) => `
        <li class="expense${x.id === editingId ? ' editing' : ''}" data-id="${x.id}">
          <span class="exp-desc">${esc(x.desc)}</span>
          <span class="exp-amt">${L.formatMoney(x.amount, x.currency)}</span>
          <span class="exp-meta">${describeSplit(x)}</span>
          <span class="exp-actions">
            <button type="button" class="text-btn edit" data-id="${x.id}" aria-label="Edit ${esc(x.desc)}">Edit</button>
            <button type="button" class="text-btn del" data-id="${x.id}" aria-label="Delete ${esc(x.desc)}">Delete</button>
          </span>
        </li>`).join('')
      : `<li class="empty">${g.people.length ? 'Nothing logged yet. Add the first expense above.' : 'Expenses you add will show up here.'}</li>`;
  }
  $('#expense-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const g = group();
    if (b.classList.contains('edit')) { startEdit(b.dataset.id); return; }
    if (b.classList.contains('del')) {
      const idx = g.expenses.findIndex((x) => x.id === b.dataset.id);
      const [removed] = g.expenses.splice(idx, 1);
      if (editingId === removed.id) resetForm();
      save(); renderAll();
      showToast(`Deleted ${removed.desc}.`, {
        label: 'Undo',
        run: () => { g.expenses.splice(idx, 0, removed); save(); renderAll(); },
      });
    }
  });

  // ---------- Balances + settle up ----------
  function activeCurrency() {
    const used = L.currenciesUsed(group());
    if (!viewCurrency || !used.includes(viewCurrency)) viewCurrency = used[0];
    return { cur: viewCurrency, used };
  }

  function renderBalances() {
    const g = group();
    const { cur, used } = activeCurrency();
    const { balances, paid, share, total } = L.computeBalances(g, cur);
    $('#total-num').textContent = L.formatMoney(total, cur);
    $('#total-label').textContent = g.expenses.length ? `Total spent in ${g.name || 'this group'}` : 'Total spent';
    $('#currency-tabs').innerHTML = used.length > 1
      ? used.map((c) => `<button type="button" data-cur="${c}" aria-pressed="${c === cur}">${c}</button>`).join('')
      : '';

    const max = Math.max(1, ...g.people.map((p) => Math.abs(balances[p.id])));
    const bars = $('#bars');
    if (!g.people.length) {
      bars.innerHTML = `<li class="empty">Add people to see who is up and who is down.</li>`;
    } else {
      // Reuse rows so the bar widths animate between states
      const existing = new Map([...bars.querySelectorAll('.bar-row')].map((li) => [li.dataset.id, li]));
      bars.querySelectorAll(':scope > :not(.bar-row)').forEach((n) => n.remove());
      g.people.forEach((p, i) => {
        const v = balances[p.id];
        let li = existing.get(p.id);
        if (!li) {
          li = document.createElement('li');
          li.className = 'bar-row';
          li.dataset.id = p.id;
          li.innerHTML = `<span class="bar-name"></span><span class="track" aria-hidden="true"><span class="fill"></span></span><span class="bar-amt"></span>`;
        }
        existing.delete(p.id);
        if (bars.children[i] !== li) bars.insertBefore(li, bars.children[i] || null);
        const sign = v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
        li.querySelector('.bar-name').innerHTML = `${esc(p.name)}<small>paid ${L.formatMoney(paid[p.id], cur)}</small>`;
        const amt = li.querySelector('.bar-amt');
        amt.className = `bar-amt ${sign}`;
        amt.textContent = v === 0 ? 'Square' : L.formatMoney(v, cur, { signed: true });
        amt.setAttribute('aria-label', v > 0 ? `is owed ${L.formatMoney(v, cur)}` : v < 0 ? `owes ${L.formatMoney(-v, cur)}` : 'is square');
        li.title = `${p.name} paid ${L.formatMoney(paid[p.id], cur)} and their share is ${L.formatMoney(share[p.id], cur)}`;
        const fill = li.querySelector('.fill');
        fill.className = `fill ${sign}`;
        fill.style.width = `${(Math.abs(v) / max) * 50}%`;
      });
      existing.forEach((li) => li.remove());
      if (!bars.querySelector('.bar-legend')) {
        const leg = document.createElement('li');
        leg.className = 'bar-legend';
        leg.setAttribute('aria-hidden', 'true');
        leg.innerHTML = '<span><span>Owes</span><span>Is owed</span></span>';
        bars.append(leg);
      } else bars.append(bars.querySelector('.bar-legend'));
    }

    const order = g.people.map((p) => p.id);
    const transfers = L.settleUp(balances, order);
    const hint = $('#settle-hint');
    const list = $('#transfers');
    if (!g.expenses.length) {
      hint.textContent = 'Once expenses are in, this shows the fewest payments that square everyone up.';
      list.innerHTML = '';
    } else if (!transfers.length) {
      hint.textContent = '';
      list.innerHTML = `<li class="square">Everyone is square in ${cur}. Nothing to pay.</li>`;
    } else {
      hint.textContent = transfers.length === 1 ? 'One payment settles everything.' : `${transfers.length} payments settle everything.`;
      list.innerHTML = transfers.map((t) => `
        <li class="transfer">
          <span class="avatar" aria-hidden="true">${esc(initials(personName(t.from)))}</span>
          <span class="transfer-text"><b>${esc(personName(t.from))}</b> pays <b>${esc(personName(t.to))}</b></span>
          <span class="transfer-amt">${L.formatMoney(t.amount, cur)}</span>
        </li>`).join('');
    }
    $('#copy-btn').disabled = !g.expenses.length;
  }
  $('#currency-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cur]');
    if (!b) return;
    viewCurrency = b.dataset.cur;
    renderBalances();
  });

  // ---------- Copy summary ----------
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }
  $('#copy-btn').addEventListener('click', async () => {
    const ok = await copyText(L.summaryText(group()));
    showToast(ok ? 'Summary copied. Paste it in your group chat.' : 'Could not copy. Your browser blocked clipboard access.');
  });

  // ---------- Example ----------
  function exampleGroup() {
    const g = blankGroup('Bali trip');
    g.example = true;
    const [alex, sam, priya, jordan] = ['Alex', 'Sam', 'Priya', 'Jordan'].map((name) => ({ id: uid(), name }));
    g.people = [alex, sam, priya, jordan];
    const all = g.people.map((p) => p.id);
    let t = Date.now();
    const add = (desc, amount, paidBy, extra = {}) => {
      g.expenses.unshift({ id: uid(), createdAt: t++, desc, amount, currency: 'AUD', paidBy: paidBy.id, participants: all, mode: 'equal', ...extra });
    };
    add('Villa in Canggu, 5 nights', 124000, alex);
    add('Scooter hire', 18000, sam);
    add('Seafood dinner at Jimbaran', 23640, priya, {
      mode: 'exact', exact: { [alex.id]: 6240, [sam.id]: 5800, [priya.id]: 7100, [jordan.id]: 4500 },
    });
    add('Groceries and water', 8735, jordan, { participants: [alex.id, sam.id, jordan.id] });
    add('Surf lessons', 21000, jordan, {
      mode: 'shares', participants: [alex.id, sam.id, jordan.id], shares: { [alex.id]: 200, [sam.id]: 100, [jordan.id]: 100 },
    });
    add('Airport transfer', 6500, alex);
    return g;
  }
  $('#example-btn').addEventListener('click', () => {
    const g = exampleGroup();
    const i = state.groups.findIndex((x) => x.example);
    if (i >= 0) state.groups.splice(i, 1, g); else state.groups.push(g);
    // Drop an untouched starter group so the example isn't next to an empty tab
    state.groups = state.groups.filter((x) => x === g || x.people.length || x.expenses.length || x.name !== 'House');
    state.activeId = g.id;
    editingId = null; viewCurrency = 'AUD';
    save(); resetForm(); renderAll();
    showToast('Loaded the Bali trip example.');
  });

  // ---------- Render ----------
  function renderAll() {
    const g = group();
    renderGroups();
    const nameIn = $('#group-name');
    if (document.activeElement !== nameIn) nameIn.value = g.name;
    renderPeople();
    renderFormOptions();
    renderExpenses();
    renderBalances();
  }

  resetForm();
  renderAll();
})();
