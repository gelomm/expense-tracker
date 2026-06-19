// ============================================================
// GASTOS — Expenses Module
// ============================================================

import { supabase, formatPHP, formatDate, monthBounds, daysUntil } from './supabase.js';
import { initAppShell, initMonthFilter, showToast, openModal, closeModal, initModalClose, categoryBadge, tagBadge, escHtml, debounce, confirm, exportCSV, exportJSON, daysLabel } from './utils.js';

let currentUser, currentProfile;
let currentMonth;
let allExpenses = [];
let editingId   = null;
let allTags     = [];
let selectedTags = [];
let splitType   = 'equal';
let allMembers  = [];

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await initAppShell('expenses');
  if (!auth) return;
  currentUser    = auth.user;
  currentProfile = auth.profile;

  currentMonth = initMonthFilter(async (m) => { currentMonth = m; await loadExpenses(); });

  await Promise.all([loadCategories(), loadMembers(), loadTags()]);
  await loadExpenses();

  initModalClose('expense-modal');
  initModalClose('view-expense-modal');
  initAddEditModal();
  initFilters();
  initExport();

  document.getElementById('btn-add-expense')?.addEventListener('click', () => openAddModal());
  document.getElementById('fab-add')?.addEventListener('click', () => openAddModal());
});

// ============================================================
// LOAD
// ============================================================
async function loadExpenses() {
  const { start, end } = monthBounds(currentMonth);
  const { data, error } = await supabase
    .from('expenses')
    .select(`
      *,
      category:categories(*),
      payer:profiles!expenses_paid_by_fkey(id, full_name),
      splits:expense_splits(*, profile:profiles(id, full_name)),
      expense_tags(tag:tags(*))
    `)
    .eq('household_id', currentProfile.household_id)
    .eq('is_deleted', false)
    .gte('expense_date', start)
    .lte('expense_date', end)
    .order('expense_date', { ascending: false });

  if (error) { showToast('Failed to load expenses.', 'error'); return; }
  allExpenses = data ?? [];
  renderTable(allExpenses);
  updateSummary(allExpenses);
}

async function loadCategories() {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .or(`household_id.is.null,household_id.eq.${currentProfile.household_id}`)
    .order('name');

  const sel = document.getElementById('exp-category');
  const filterSel = document.getElementById('filter-category');
  const opts = '<option value="">— No category —</option>' +
    (data ?? []).map(c => `<option value="${c.id}">${c.icon} ${escHtml(c.name)}</option>`).join('');

  if (sel) sel.innerHTML = opts;
  if (filterSel) filterSel.innerHTML = '<option value="">All Categories</option>' +
    (data ?? []).map(c => `<option value="${c.id}">${c.icon} ${escHtml(c.name)}</option>`).join('');
}

async function loadMembers() {
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('household_id', currentProfile.household_id);
  allMembers = data ?? [];

  const sel = document.getElementById('exp-paid-by');
  if (sel) {
    sel.innerHTML = allMembers
      .map(m => `<option value="${m.id}" ${m.id === currentUser.id ? 'selected' : ''}>${escHtml(m.full_name)}</option>`)
      .join('');
  }
}

async function loadTags() {
  const { data } = await supabase
    .from('tags')
    .select('*')
    .or(`household_id.is.null,household_id.eq.${currentProfile.household_id}`)
    .order('name');
  allTags = data ?? [];
}

// ============================================================
// RENDER TABLE
// ============================================================
function renderTable(expenses) {
  const tbody = document.getElementById('expenses-tbody');
  if (!tbody) return;

  // Apply filters
  const search   = document.getElementById('search-input')?.value.toLowerCase() ?? '';
  const catFilter = document.getElementById('filter-category')?.value ?? '';
  const statusFilter = document.getElementById('filter-status')?.value ?? '';
  const sort     = document.getElementById('filter-sort')?.value ?? 'date_desc';

  let filtered = expenses.filter(e => {
    if (search && !e.title.toLowerCase().includes(search)) return false;
    if (catFilter && e.category_id !== catFilter) return false;
    if (statusFilter && e.status !== statusFilter) return false;
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    if (sort === 'date_desc')   return new Date(b.expense_date) - new Date(a.expense_date);
    if (sort === 'date_asc')    return new Date(a.expense_date) - new Date(b.expense_date);
    if (sort === 'amount_desc') return b.amount - a.amount;
    if (sort === 'amount_asc')  return a.amount - b.amount;
    return 0;
  });

  updateSummary(filtered);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state">
        <div class="empty-icon">💸</div>
        <div class="empty-title">No expenses found</div>
        <div class="empty-text">Add your first expense for this month.</div>
        <button class="btn btn-primary" style="margin-top:var(--space-4);" onclick="document.getElementById('btn-add-expense').click()">Add Expense</button>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    const tags  = (e.expense_tags ?? []).map(et => tagBadge(et.tag)).join('');
    const splits = (e.splits ?? []);
    const splitAvatars = splits.map(s =>
      `<div class="split-avatar" title="${escHtml(s.profile?.full_name ?? '')}">${(s.profile?.full_name?.[0] ?? '?').toUpperCase()}</div>`
    ).join('');

    const daysLeft = e.due_date ? daysUntil(e.due_date) : null;
    const dueBadge = e.due_date
      ? `<div class="text-xs ${daysLeft !== null && daysLeft < 0 ? 'text-danger' : daysLeft !== null && daysLeft <= 3 ? 'text-warning' : 'text-muted'}">${daysLabel(daysLeft ?? 0)}</div>`
      : '<span class="text-muted">—</span>';

    return `
      <tr data-id="${e.id}">
        <td>
          <div class="expense-title-cell">
            <span style="font-size:1.1rem;">${e.category?.icon ?? '📦'}</span>
            <div>
              <div class="font-medium">${escHtml(e.title)}</div>
              ${tags ? `<div class="expense-tags">${tags}</div>` : ''}
            </div>
          </div>
        </td>
        <td>${categoryBadge(e.category)}</td>
        <td><span class="text-sm">${formatDate(e.expense_date)}</span></td>
        <td>${dueBadge}</td>
        <td><span class="badge ${statusClass(e.status)}">${capitalize(e.status)}</span></td>
        <td>
          ${splits.length > 0
            ? `<div class="split-members">${splitAvatars}<span class="text-xs text-muted" style="margin-left:2px;">${splits.length}</span></div>`
            : '<span class="text-muted text-xs">—</span>'}
        </td>
        <td class="amount-cell">${formatPHP(e.amount)}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-ghost btn-icon btn-sm" onclick="viewExpense('${e.id}')" title="View">👁️</button>
            <button class="btn btn-ghost btn-icon btn-sm" onclick="editExpense('${e.id}')" title="Edit">✏️</button>
            ${e.status !== 'paid'
              ? `<button class="btn btn-ghost btn-icon btn-sm" onclick="markPaid('${e.id}')" title="Mark paid">✅</button>`
              : ''}
            <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteExpense('${e.id}')" title="Delete" style="color:var(--clr-danger);">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ============================================================
// SUMMARY BAR
// ============================================================
function updateSummary(expenses) {
  const total   = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const overdue = expenses.filter(e => e.status === 'overdue').length;

  const cntEl = document.getElementById('summary-count');
  const totEl = document.getElementById('summary-total');
  const ovEl  = document.getElementById('summary-overdue');

  if (cntEl) cntEl.textContent = `${expenses.length} expense${expenses.length !== 1 ? 's' : ''}`;
  if (totEl) totEl.textContent = `Total: ${formatPHP(total)}`;
  if (ovEl) {
    ovEl.textContent = `${overdue} overdue`;
    ovEl.style.display = overdue > 0 ? '' : 'none';
  }
}

// ============================================================
// ADD / EDIT MODAL
// ============================================================
function openAddModal() {
  editingId = null;
  document.getElementById('expense-modal-title').textContent = 'Add Expense';
  document.getElementById('exp-title').value    = '';
  document.getElementById('exp-amount').value   = '';
  document.getElementById('exp-notes').value    = '';
  document.getElementById('exp-status').value   = 'unpaid';
  document.getElementById('exp-date').value     = new Date().toISOString().split('T')[0];
  document.getElementById('exp-due-date').value = '';
  document.getElementById('exp-paid-by').value  = currentUser.id;
  document.getElementById('exp-split-toggle').checked = false;
  document.getElementById('exp-split-section').classList.add('hidden');
  selectedTags = [];
  renderSelectedTags();
  openModal('expense-modal');
}

async function editExpense(id) {
  const exp = allExpenses.find(e => e.id === id);
  if (!exp) return;

  editingId = id;
  document.getElementById('expense-modal-title').textContent = 'Edit Expense';
  document.getElementById('exp-title').value    = exp.title;
  document.getElementById('exp-amount').value   = exp.amount;
  document.getElementById('exp-notes').value    = exp.notes ?? '';
  document.getElementById('exp-status').value   = exp.status;
  document.getElementById('exp-date').value     = exp.expense_date;
  document.getElementById('exp-due-date').value = exp.due_date ?? '';
  document.getElementById('exp-category').value = exp.category_id ?? '';
  document.getElementById('exp-paid-by').value  = exp.paid_by ?? currentUser.id;

  selectedTags = (exp.expense_tags ?? []).map(et => et.tag).filter(Boolean);
  renderSelectedTags();

  const splits = exp.splits ?? [];
  if (splits.length > 0) {
    document.getElementById('exp-split-toggle').checked = true;
    document.getElementById('exp-split-section').classList.remove('hidden');
    renderSplitMembers(Number(exp.amount));
  } else {
    document.getElementById('exp-split-toggle').checked = false;
    document.getElementById('exp-split-section').classList.add('hidden');
  }

  openModal('expense-modal');
}

function initAddEditModal() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('exp-date').value = today;

  // Split toggle
  document.getElementById('exp-split-toggle')?.addEventListener('change', (e) => {
    const section = document.getElementById('exp-split-section');
    if (e.target.checked) {
      section.classList.remove('hidden');
      const amt = parseFloat(document.getElementById('exp-amount').value) || 0;
      renderSplitMembers(amt);
    } else {
      section.classList.add('hidden');
    }
  });

  // Update split amounts when total changes
  document.getElementById('exp-amount')?.addEventListener('input', () => {
    if (document.getElementById('exp-split-toggle').checked) {
      const amt = parseFloat(document.getElementById('exp-amount').value) || 0;
      renderSplitMembers(amt);
    }
  });

  // Split type tabs
  document.querySelectorAll('.split-type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.split-type-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      splitType = btn.dataset.splitType;
      const amt = parseFloat(document.getElementById('exp-amount').value) || 0;
      renderSplitMembers(amt);
    });
  });

  // Tags search
  const tagsSearch = document.getElementById('exp-tags-search');
  const tagsDropdown = document.getElementById('exp-tags-dropdown');

  tagsSearch?.addEventListener('input', debounce(() => {
    const q = tagsSearch.value.toLowerCase();
    const filtered = allTags.filter(t =>
      t.name.toLowerCase().includes(q) && !selectedTags.find(s => s.id === t.id)
    );
    if (filtered.length === 0) { tagsDropdown.classList.add('hidden'); return; }
    tagsDropdown.innerHTML = filtered.map(t => `
      <div class="tag-option" data-id="${t.id}">
        <span class="color-dot" style="background:${t.color};"></span>
        ${escHtml(t.name)}
      </div>
    `).join('');
    tagsDropdown.classList.remove('hidden');
    tagsDropdown.querySelectorAll('.tag-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const tag = allTags.find(t => t.id === opt.dataset.id);
        if (tag) { selectedTags.push(tag); renderSelectedTags(); }
        tagsDropdown.classList.add('hidden');
        tagsSearch.value = '';
      });
    });
  }, 150));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#exp-tags-input')) tagsDropdown?.classList.add('hidden');
  });

  // Submit
  document.getElementById('exp-submit')?.addEventListener('click', saveExpense);
}

function renderSplitMembers(totalAmount) {
  const container = document.getElementById('exp-split-members-list');
  const totalRow  = document.getElementById('split-total-row');
  if (!container) return;

  const others = allMembers.filter(m => m.id !== currentUser.id);
  if (others.length === 0) {
    container.innerHTML = '<p class="text-sm text-muted">No other members in this household.</p>';
    return;
  }

  const equalShare = totalAmount / (others.length + 1);

  container.innerHTML = `
    <div class="split-member-row" style="font-size:var(--text-xs);font-weight:600;color:var(--clr-text-muted);padding-bottom:var(--space-2);">
      <span>Member</span>
      <span>${splitType === 'percentage' ? 'Percentage' : 'Amount'}</span>
      <span>Include</span>
    </div>
    ${others.map(m => `
      <div class="split-member-row" id="split-row-${m.id}">
        <div class="flex items-center gap-2">
          <div class="avatar" style="width:28px;height:28px;font-size:0.65rem;">${m.full_name[0].toUpperCase()}</div>
          <span class="text-sm font-medium">${escHtml(m.full_name)}</span>
        </div>
        <div class="input-group">
          ${splitType === 'percentage' ? '' : '<span class="input-prefix" style="font-size:0.75rem;">₱</span>'}
          <input
            class="form-control ${splitType !== 'percentage' ? 'has-prefix' : ''}"
            style="font-size:var(--text-sm);padding:var(--space-2) var(--space-3);${splitType !== 'percentage' ? 'padding-left:var(--space-6);' : ''}"
            id="split-amount-${m.id}"
            type="number" min="0" step="${splitType === 'percentage' ? '1' : '0.01'}"
            value="${splitType === 'equal' ? equalShare.toFixed(2) : splitType === 'percentage' ? Math.round(100/(others.length+1)) : ''}"
            ${splitType === 'equal' ? 'readonly' : ''}
            data-member-id="${m.id}"
            oninput="updateSplitTotal()"
          />
          ${splitType === 'percentage' ? '<span class="input-suffix">%</span>' : ''}
        </div>
        <label class="form-check">
          <input type="checkbox" class="split-include-check" value="${m.id}" checked />
        </label>
      </div>
    `).join('')}
  `;

  if (totalRow) totalRow.style.display = '';
  updateSplitTotal();
}

window.updateSplitTotal = function() {
  const totalEl = document.getElementById('split-total-value');
  if (!totalEl) return;
  const inputs = document.querySelectorAll('[id^="split-amount-"]');
  let sum = 0;
  inputs.forEach(inp => {
    const check = document.querySelector(`.split-include-check[value="${inp.dataset.memberId}"]`);
    if (check?.checked) sum += parseFloat(inp.value) || 0;
  });
  const total = parseFloat(document.getElementById('exp-amount')?.value) || 0;
  const display = splitType === 'percentage' ? `${sum.toFixed(0)}%` : formatPHP(sum);
  totalEl.textContent = display;
  totalEl.style.color = (splitType === 'percentage' && sum > 100) || (splitType !== 'percentage' && sum > total + 0.01)
    ? 'var(--clr-danger)' : 'var(--clr-success)';
};

function renderSelectedTags() {
  const container = document.getElementById('exp-selected-tags');
  if (!container) return;
  container.innerHTML = selectedTags.map(t => `
    <span class="tag tag-removable" style="background:${hexToAlpha(t.color,0.15)};color:${t.color};border-color:${hexToAlpha(t.color,0.3)};">
      ${escHtml(t.name)}
      <button onclick="removeTag('${t.id}')" title="Remove">✕</button>
    </span>
  `).join('');
}

window.removeTag = function(tagId) {
  selectedTags = selectedTags.filter(t => t.id !== tagId);
  renderSelectedTags();
};

function hexToAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ============================================================
// SAVE EXPENSE
// ============================================================
async function saveExpense() {
  const title     = document.getElementById('exp-title')?.value.trim();
  const amount    = parseFloat(document.getElementById('exp-amount')?.value);
  const date      = document.getElementById('exp-date')?.value;
  const dueDate   = document.getElementById('exp-due-date')?.value || null;
  const catId     = document.getElementById('exp-category')?.value || null;
  const paidBy    = document.getElementById('exp-paid-by')?.value || currentUser.id;
  const status    = document.getElementById('exp-status')?.value ?? 'unpaid';
  const notes     = document.getElementById('exp-notes')?.value.trim() || null;

  if (!title || isNaN(amount) || amount <= 0 || !date) {
    showToast('Title, amount, and date are required.', 'warning'); return;
  }

  const btn = document.getElementById('exp-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  const payload = {
    household_id: currentProfile.household_id,
    title, amount, expense_date: date,
    due_date: dueDate, category_id: catId, paid_by: paidBy,
    status, notes, created_by: currentUser.id,
  };

  let expenseId = editingId;

  if (editingId) {
    const { error } = await supabase.from('expenses').update(payload).eq('id', editingId);
    if (error) { showToast('Failed to update expense.', 'error'); btn.disabled=false; btn.textContent='Save Expense'; return; }
  } else {
    const { data, error } = await supabase.from('expenses').insert(payload).select().single();
    if (error) { showToast('Failed to add expense.', 'error'); btn.disabled=false; btn.textContent='Save Expense'; return; }
    expenseId = data.id;
  }

  // Save tags
  if (expenseId) {
    await supabase.from('expense_tags').delete().eq('expense_id', expenseId);
    if (selectedTags.length > 0) {
      await supabase.from('expense_tags').insert(
        selectedTags.map(t => ({ expense_id: expenseId, tag_id: t.id }))
      );
    }

    // Save splits
    await supabase.from('expense_splits').delete().eq('expense_id', expenseId);
    if (document.getElementById('exp-split-toggle')?.checked) {
      const checks = document.querySelectorAll('.split-include-check:checked');
      const splits = [...checks].map(c => {
        const mid   = c.value;
        const input = document.getElementById(`split-amount-${mid}`);
        const val   = parseFloat(input?.value) || 0;
        return {
          expense_id: expenseId,
          profile_id: mid,
          split_type: splitType,
          amount: splitType === 'equal' ? val : splitType === 'fixed' ? val : amount * (val / 100),
          percentage: splitType === 'percentage' ? val : null,
        };
      });
      if (splits.length > 0) await supabase.from('expense_splits').insert(splits);
    }
  }

  // ── Auto-reminder based on due date ──────────────────────────────────────
  // Rules:
  //   • New expense with due date   → create a reminder 1 day before at 9 AM
  //   • Edited expense, due date changed → update existing auto-reminder to new date
  //   • Edited expense, due date removed → delete existing auto-reminder
  if (expenseId) {
    await syncAutoReminder(expenseId, dueDate);
  }

  showToast(editingId ? 'Expense updated!' : 'Expense added!', 'success');
  closeModal('expense-modal');
  await loadExpenses();
  btn.disabled = false;
  btn.textContent = 'Save Expense';
}

/**
 * Syncs a single auto-generated reminder for an expense based on its due date.
 * - If dueDate is set   → upsert a reminder for 1 day before at 9:00 AM (PH time)
 * - If dueDate is null  → delete any existing auto-reminder for this expense
 *
 * Auto-reminders are identified by the sentinel message '__auto__' so they
 * can be distinguished from manually created reminders without a schema change.
 */
async function syncAutoReminder(expenseId, dueDate) {
  if (dueDate) {
    // Compute remind_at: due date minus 1 day at 09:00 local time (Asia/Manila)
    const due = new Date(dueDate + 'T00:00:00');
    due.setDate(due.getDate() - 1);
    due.setHours(9, 0, 0, 0);
    const remindAt = due.toISOString();

    // Check if an auto-reminder already exists for this expense
    const { data: existing } = await supabase
      .from('reminders')
      .select('id')
      .eq('expense_id', expenseId)
      .eq('message', '__auto__')
      .maybeSingle();

    if (existing) {
      // Update the remind_at to reflect the new due date
      const { error } = await supabase
        .from('reminders')
        .update({ remind_at: remindAt, is_sent: false })
        .eq('id', existing.id);
      if (error) console.error('Auto-reminder update failed:', error);
    } else {
      // Create a new auto-reminder
      const { error } = await supabase.from('reminders').insert({
        expense_id:  expenseId,
        profile_id:  currentUser.id,
        remind_at:   remindAt,
        type:        'email',
        message:     '__auto__',
        is_sent:     false,
        is_read:     false,
      });
      if (error) console.error('Auto-reminder insert failed:', error);
    }
  } else {
    // Due date was removed — delete the auto-reminder if it exists
    await supabase
      .from('reminders')
      .delete()
      .eq('expense_id', expenseId)
      .eq('message', '__auto__');
  }
}

// ============================================================
// VIEW EXPENSE
// ============================================================
window.viewExpense = function(id) {
  const exp = allExpenses.find(e => e.id === id);
  if (!exp) return;

  const body = document.getElementById('view-expense-body');
  const tags = (exp.expense_tags ?? []).map(et => tagBadge(et.tag)).join('') || '<span class="text-muted">None</span>';
  const splits = (exp.splits ?? []);

  body.innerHTML = `
    <div class="flex items-center gap-3 mb-4">
      <span style="font-size:2rem;">${exp.category?.icon ?? '📦'}</span>
      <div>
        <div class="text-xl font-bold">${escHtml(exp.title)}</div>
        <div class="text-muted text-sm">${formatDate(exp.expense_date)}</div>
      </div>
      <div class="ml-auto font-mono font-bold text-2xl">${formatPHP(exp.amount)}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4);margin-bottom:var(--space-4);">
      <div><div class="section-title">Category</div>${categoryBadge(exp.category)}</div>
      <div><div class="section-title">Status</div><span class="badge ${statusClass(exp.status)}">${capitalize(exp.status)}</span></div>
      <div><div class="section-title">Due Date</div><span class="text-sm">${exp.due_date ? formatDate(exp.due_date) : '—'}</span></div>
      <div><div class="section-title">Paid By</div><span class="text-sm">${escHtml(exp.payer?.full_name ?? '—')}</span></div>
    </div>
    <div class="mb-4"><div class="section-title">Tags</div><div class="flex gap-2 flex-wrap">${tags}</div></div>
    ${exp.notes ? `<div class="mb-4"><div class="section-title">Notes</div><p class="text-sm">${escHtml(exp.notes)}</p></div>` : ''}
    ${splits.length > 0 ? `
      <div><div class="section-title">Splits</div>
        ${splits.map(s => `
          <div class="split-row">
            <div class="avatar" style="width:28px;height:28px;font-size:0.65rem;">${(s.profile?.full_name?.[0] ?? '?').toUpperCase()}</div>
            <div style="flex:1;">${escHtml(s.profile?.full_name ?? 'Member')}</div>
            <div class="font-mono text-sm">${formatPHP(s.amount)}</div>
            <span class="badge ${s.is_settled ? 'badge-success' : 'badge-warning'}">${s.is_settled ? 'Settled' : 'Pending'}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  document.getElementById('view-edit-btn').onclick = () => {
    closeModal('view-expense-modal');
    editExpense(id);
  };
  openModal('view-expense-modal');
};

window.editExpense   = editExpense;
window.markPaid      = async function(id) {
  const { error } = await supabase.from('expenses').update({ status: 'paid' }).eq('id', id);
  if (error) { showToast('Failed to update status.', 'error'); return; }
  showToast('Marked as paid!', 'success');
  await loadExpenses();
};

window.deleteExpense = async function(id) {
  const ok = await confirm('Archive this expense? It can be recovered later.', 'Archive Expense');
  if (!ok) return;
  const { error } = await supabase.from('expenses').update({ is_deleted: true }).eq('id', id);
  if (error) { showToast('Failed to delete.', 'error'); return; }
  showToast('Expense archived.', 'info');
  await loadExpenses();
};

// ============================================================
// FILTERS
// ============================================================
function initFilters() {
  const debouncedRender = debounce(() => renderTable(allExpenses), 200);
  document.getElementById('search-input')?.addEventListener('input', debouncedRender);
  document.getElementById('filter-category')?.addEventListener('change', () => renderTable(allExpenses));
  document.getElementById('filter-status')?.addEventListener('change', () => renderTable(allExpenses));
  document.getElementById('filter-sort')?.addEventListener('change', () => renderTable(allExpenses));
}

// ============================================================
// EXPORT
// ============================================================
function initExport() {
  document.getElementById('btn-export')?.addEventListener('click', () => {
    const rows = allExpenses.map(e => ({
      Title: e.title,
      Amount: e.amount,
      Category: e.category?.name ?? '',
      Date: e.expense_date,
      DueDate: e.due_date ?? '',
      Status: e.status,
      PaidBy: e.payer?.full_name ?? '',
      Notes: e.notes ?? '',
    }));
    exportCSV(rows, ['Title','Amount','Category','Date','DueDate','Status','PaidBy','Notes'], `gastos-expenses-${currentMonth}.csv`);
    showToast('Exported to CSV!', 'success');
  });
}

// ============================================================
// HELPERS
// ============================================================
function statusClass(s) {
  return { paid: 'status-paid', unpaid: 'status-unpaid', overdue: 'status-overdue' }[s] ?? 'badge-neutral';
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }