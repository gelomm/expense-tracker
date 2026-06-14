// ============================================================
// GASTOS — Dashboard Module
// ============================================================

import { supabase, formatPHP, monthBounds, daysUntil } from './supabase.js';
import { initAppShell, initMonthFilter, showToast, openModal, closeModal, initModalClose, categoryBadge, daysLabel, escHtml } from './utils.js';

let currentUser, currentProfile, currentMonth;
let categoryChart = null;

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const auth = await initAppShell('dashboard');
  if (!auth) return;
  currentUser    = auth.user;
  currentProfile = auth.profile;

  currentMonth = initMonthFilter((month) => {
    currentMonth = month;
    loadAllDashboard();
  });

  await loadAllDashboard();
  initQuickAdd();
  initModalClose('quick-add-modal');

  document.getElementById('fab-add')?.addEventListener('click', () => openModal('quick-add-modal'));
});

// ============================================================
// LOAD ALL
// ============================================================
async function loadAllDashboard() {
  const householdId = currentProfile?.household_id;
  if (!householdId) {
    showEmptyHousehold();
    return;
  }

  const { start, end } = monthBounds(currentMonth);

  const [expenses, budgets, recurring, splits, members] = await Promise.all([
    fetchExpenses(householdId, start, end),
    fetchBudgets(householdId, currentMonth),
    fetchRecurring(householdId),
    fetchSplits(householdId),
    fetchMembers(householdId),
  ]);

  renderKPIs(expenses, budgets, recurring);
  renderCategoryChart(expenses);
  renderBudgetRows(expenses, budgets);
  renderUpcoming(expenses);
  renderSplitsSummary(splits, members);
  renderRecurringOverview(recurring);
}

// ============================================================
// DATA FETCHERS
// ============================================================
async function fetchExpenses(householdId, start, end) {
  const { data } = await supabase
    .from('expenses')
    .select('*, category:categories(*), splits:expense_splits(*, profile:profiles(id,full_name))')
    .eq('household_id', householdId)
    .gte('expense_date', start)
    .lte('expense_date', end)
    .eq('is_deleted', false);
  return data ?? [];
}

async function fetchBudgets(householdId, month) {
  const { data } = await supabase
    .from('budgets')
    .select('*, category:categories(*)')
    .eq('household_id', householdId)
    .eq('month', month);
  return data ?? [];
}

async function fetchRecurring(householdId) {
  const { data } = await supabase
    .from('recurring_expenses')
    .select('*, category:categories(*), payer:profiles(id,full_name)')
    .eq('household_id', householdId)
    .eq('is_active', true)
    .order('next_due_date', { ascending: true });
  return data ?? [];
}

async function fetchSplits(householdId) {
  const { data } = await supabase
    .from('expense_splits')
    .select('*, expense:expenses(title, amount, household_id), profile:profiles(id,full_name)')
    .eq('is_settled', false)
    .not('profile_id', 'is', null);

  // Filter to only this household
  return (data ?? []).filter(s => s.expense?.household_id === householdId);
}

async function fetchMembers(householdId) {
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('household_id', householdId);
  return data ?? [];
}

// ============================================================
// KPI CARDS
// ============================================================
function renderKPIs(expenses, budgets, recurring) {
  const totalSpent  = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalBudget = budgets.reduce((s, b) => s + Number(b.amount), 0);
  const overdue     = expenses.filter(e => e.status === 'overdue').length;
  const upcoming7   = expenses.filter(e => {
    if (!e.due_date) return false;
    const d = daysUntil(e.due_date);
    return d >= 0 && d <= 7 && e.status !== 'paid';
  }).length;
  const recurringTotal = recurring.reduce((s, r) => s + Number(r.amount), 0);
  const budgetPct      = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : null;

  const grid = document.getElementById('kpi-grid');
  grid.innerHTML = `
    <div class="stat-card" style="--card-accent:var(--clr-primary);--card-icon-bg:var(--clr-primary-light);">
      <div class="stat-icon">💸</div>
      <div class="stat-label">Total Spent</div>
      <div class="stat-value">${formatPHP(totalSpent)}</div>
      ${budgetPct !== null ? `
        <div class="stat-change ${budgetPct > 100 ? 'negative' : 'positive'}">
          <span>${budgetPct}% of ${formatPHP(totalBudget)} budget</span>
        </div>
      ` : '<div class="stat-change"><span class="text-muted">No budget set</span></div>'}
    </div>

    <div class="stat-card" style="--card-accent:var(--clr-danger);--card-icon-bg:var(--clr-danger-light);">
      <div class="stat-icon">⚠️</div>
      <div class="stat-label">Overdue</div>
      <div class="stat-value" style="color:${overdue > 0 ? 'var(--clr-danger)' : 'var(--clr-text)'}">
        ${overdue}
      </div>
      <div class="stat-change">
        <span class="${overdue > 0 ? 'text-danger' : 'text-muted'}">
          ${overdue > 0 ? 'Needs attention' : 'All clear!'}
        </span>
      </div>
    </div>

    <div class="stat-card" style="--card-accent:var(--clr-warning);--card-icon-bg:var(--clr-warning-light);">
      <div class="stat-icon">📅</div>
      <div class="stat-label">Due This Week</div>
      <div class="stat-value">${upcoming7}</div>
      <div class="stat-change">
        <span class="text-muted">expense${upcoming7 !== 1 ? 's' : ''} upcoming</span>
      </div>
    </div>

    <div class="stat-card" style="--card-accent:var(--clr-success);--card-icon-bg:var(--clr-success-light);">
      <div class="stat-icon">🔁</div>
      <div class="stat-label">Recurring / Month</div>
      <div class="stat-value">${formatPHP(recurringTotal)}</div>
      <div class="stat-change">
        <span class="text-muted">${recurring.length} active plan${recurring.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  `;
}

// ============================================================
// CATEGORY CHART (Doughnut)
// ============================================================
function renderCategoryChart(expenses) {
  const ctx = document.getElementById('category-chart');
  if (!ctx) return;

  // Group by category
  const groups = {};
  for (const exp of expenses) {
    const key   = exp.category?.name ?? 'Uncategorized';
    const color = exp.category?.color ?? '#9CA3AF';
    if (!groups[key]) groups[key] = { amount: 0, color };
    groups[key].amount += Number(exp.amount);
  }

  const labels = Object.keys(groups);
  const data   = labels.map(k => groups[k].amount);
  const colors = labels.map(k => groups[k].color);

  if (categoryChart) categoryChart.destroy();

  if (labels.length === 0) {
    ctx.parentElement.innerHTML = `
      <div class="empty-state" style="padding:var(--space-8);">
        <div class="empty-icon">📊</div>
        <div class="empty-text">No expenses this month</div>
      </div>`;
    return;
  }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderColor: isDark ? '#111827' : '#ffffff',
        borderWidth: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            font: { family: 'Inter', size: 11 },
            color: isDark ? '#94A3B8' : '#475569',
            padding: 12,
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatPHP(ctx.raw)}`,
          },
        },
      },
    },
  });
}

// ============================================================
// BUDGET ROWS
// ============================================================
function renderBudgetRows(expenses, budgets) {
  const container = document.getElementById('budget-rows');
  if (!container) return;

  if (budgets.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-6);">
        <div class="empty-icon">🎯</div>
        <div class="empty-text">No budgets set yet</div>
        <a href="/expense-tracker/settings.html#budgets" class="btn btn-sm btn-primary" style="margin-top:var(--space-3);">Set Budgets</a>
      </div>`;
    return;
  }

  // Tally spending per category
  const spent = {};
  for (const e of expenses) {
    const cid = e.category_id ?? 'none';
    spent[cid] = (spent[cid] ?? 0) + Number(e.amount);
  }

  container.innerHTML = budgets.slice(0, 6).map(b => {
    const s    = spent[b.category_id] ?? 0;
    const pct  = Math.min(Math.round((s / b.amount) * 100), 100);
    const over = s > b.amount;
    const barClass = over ? 'danger' : pct > 80 ? 'warning' : '';

    return `
      <div class="budget-item">
        <div class="budget-meta">
          <span class="budget-label">
            <span>${b.category?.icon ?? '📦'}</span>
            <span>${escHtml(b.category?.name ?? 'Uncategorized')}</span>
          </span>
          <span class="budget-amounts">
            ${formatPHP(s)} / ${formatPHP(b.amount)}
            ${over ? '<span class="badge badge-danger" style="margin-left:4px;">Over</span>' : ''}
          </span>
        </div>
        <div class="progress">
          <div class="progress-bar ${barClass}" style="width:${pct}%;"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// UPCOMING DUE
// ============================================================
function renderUpcoming(expenses) {
  const container = document.getElementById('upcoming-list');
  if (!container) return;

  const upcoming = expenses
    .filter(e => e.due_date && e.status !== 'paid')
    .map(e => ({ ...e, daysLeft: daysUntil(e.due_date) }))
    .filter(e => e.daysLeft >= 0 && e.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (upcoming.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-4);">
        <div class="empty-icon">✅</div>
        <div class="empty-text">Nothing due this week!</div>
      </div>`;
    return;
  }

  container.innerHTML = upcoming.map(e => {
    const urgency = e.daysLeft === 0 ? 'urgent' : e.daysLeft <= 3 ? 'soon' : 'ok';
    return `
      <div class="upcoming-item ${urgency}">
        <span style="font-size:1.3rem;">${e.category?.icon ?? '📦'}</span>
        <div class="upcoming-info">
          <div class="upcoming-title">${escHtml(e.title)}</div>
          <div class="upcoming-due">${daysLabel(e.daysLeft)}</div>
        </div>
        <div class="upcoming-amount">${formatPHP(e.amount)}</div>
      </div>
    `;
  }).join('');
}

// ============================================================
// SPLITS SUMMARY
// ============================================================
function renderSplitsSummary(splits, members) {
  const container = document.getElementById('splits-summary');
  if (!container) return;

  // Net balance per member from current user's perspective
  const balances = {};
  for (const s of splits) {
    const mid  = s.profile_id;
    if (mid === currentUser.id) continue; // skip self
    if (!balances[mid]) balances[mid] = { name: s.profile?.full_name ?? 'Member', net: 0 };

    // If someone else is in a split for an expense paid by current user → they owe us
    if (s.expense && s.profile_id !== currentUser.id) {
      // simplified: track unsettled amounts
      balances[mid].net += Number(s.amount ?? 0);
    }
  }

  const entries = Object.values(balances).filter(b => Math.abs(b.net) > 0.01);

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-4);">
        <div class="empty-icon">🤝</div>
        <div class="empty-text">All settled up!</div>
      </div>`;
    return;
  }

  container.innerHTML = entries.map(e => `
    <div class="split-row">
      <div class="avatar" style="width:32px;height:32px;font-size:0.75rem;">${(e.name[0] ?? 'M').toUpperCase()}</div>
      <div style="flex:1;">
        <div class="text-sm font-medium">${escHtml(e.name)}</div>
        <div class="split-direction ${e.net > 0 ? 'owed' : 'owe'}">
          ${e.net > 0 ? 'owes you' : 'you owe'}
        </div>
      </div>
      <div class="font-mono font-semibold text-sm ${e.net > 0 ? 'text-success' : 'text-danger'}">
        ${formatPHP(Math.abs(e.net))}
      </div>
    </div>
  `).join('');
}

// ============================================================
// RECURRING OVERVIEW
// ============================================================
function renderRecurringOverview(recurring) {
  const container = document.getElementById('recurring-overview');
  if (!container) return;

  if (recurring.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:var(--space-4);">
        <div class="empty-icon">🔁</div>
        <div class="empty-text">No recurring expenses</div>
        <a href="/expense-tracker/recurring.html" class="btn btn-sm btn-primary" style="margin-top:var(--space-3);">Add one</a>
      </div>`;
    return;
  }

  const freqLabel = { daily:'Daily', weekly:'Weekly', biweekly:'Bi-weekly', monthly:'Monthly', bimonthly:'Bi-monthly', annually:'Annually' };

  container.innerHTML = recurring.slice(0, 5).map(r => `
    <div class="recurring-item">
      <span style="font-size:1.1rem;">${r.category?.icon ?? '🔁'}</span>
      <div style="flex:1;min-width:0;">
        <div class="text-sm font-medium truncate">${escHtml(r.title)}</div>
        <div class="text-xs text-muted">${freqLabel[r.frequency] ?? r.frequency}</div>
      </div>
      <div class="font-mono font-semibold text-sm">${formatPHP(r.amount)}</div>
    </div>
  `).join('');

  if (recurring.length > 5) {
    container.innerHTML += `<div class="text-xs text-muted text-center" style="margin-top:var(--space-2);">
      +${recurring.length - 5} more · <a href="/expense-tracker/recurring.html" style="color:var(--clr-primary)">View all</a>
    </div>`;
  }
}

// ============================================================
// QUICK ADD
// ============================================================
function initQuickAdd() {
  // Set today's date
  const today = new Date().toISOString().split('T')[0];
  const qaDate = document.getElementById('qa-date');
  if (qaDate) qaDate.value = today;

  // Load categories
  loadCategoriesForSelect('qa-category');

  // Split toggle
  document.getElementById('qa-split-toggle')?.addEventListener('change', async (e) => {
    const section = document.getElementById('qa-split-section');
    if (e.target.checked) {
      section.classList.remove('hidden');
      await loadSplitMembers('qa-split-members');
    } else {
      section.classList.add('hidden');
    }
  });

  // Submit
  document.getElementById('qa-submit')?.addEventListener('click', async () => {
    const title      = document.getElementById('qa-title')?.value.trim();
    const amount     = parseFloat(document.getElementById('qa-amount')?.value);
    const date       = document.getElementById('qa-date')?.value;
    const categoryId = document.getElementById('qa-category')?.value || null;
    const dueDate    = document.getElementById('qa-due-date')?.value || null;

    if (!title || isNaN(amount) || amount <= 0) {
      showToast('Please enter a title and valid amount.', 'warning');
      return;
    }

    const btn = document.getElementById('qa-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const { data: expense, error } = await supabase.from('expenses').insert({
      household_id: currentProfile.household_id,
      title,
      amount,
      category_id: categoryId || null,
      paid_by: currentUser.id,
      expense_date: date,
      due_date: dueDate || null,
      status: 'unpaid',
      created_by: currentUser.id,
    }).select().single();

    if (error) {
      showToast('Failed to add expense. Try again.', 'error');
    } else {
      // Handle splits
      const splitChecks = document.querySelectorAll('.qa-split-check:checked');
      if (splitChecks.length > 0) {
        const splitAmount = amount / (splitChecks.length + 1);
        const splits = [...splitChecks].map(c => ({
          expense_id: expense.id,
          profile_id: c.value,
          split_type: 'equal',
          amount: splitAmount,
        }));
        await supabase.from('expense_splits').insert(splits);
      }

      showToast('Expense added!', 'success');
      closeModal('quick-add-modal');
      document.getElementById('qa-title').value = '';
      document.getElementById('qa-amount').value = '';
      await loadAllDashboard();
    }

    btn.disabled = false;
    btn.textContent = 'Add Expense';
  });
}

async function loadCategoriesForSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  const { data } = await supabase
    .from('categories')
    .select('*')
    .or(`household_id.is.null,household_id.eq.${currentProfile?.household_id}`)
    .order('name');

  sel.innerHTML = '<option value="">— No category —</option>' +
    (data ?? []).map(c => `<option value="${c.id}">${c.icon} ${escHtml(c.name)}</option>`).join('');
}

async function loadSplitMembers(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { data: members } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('household_id', currentProfile?.household_id)
    .neq('id', currentUser.id);

  if (!members || members.length === 0) {
    container.innerHTML = '<p class="text-sm text-muted">No other members in your household yet.</p>';
    return;
  }

  container.innerHTML = members.map(m => `
    <label class="form-check" style="padding:var(--space-2) 0;">
      <input type="checkbox" class="qa-split-check" value="${m.id}" />
      <div class="avatar" style="width:28px;height:28px;font-size:0.7rem;">${m.full_name[0].toUpperCase()}</div>
      <span class="form-check-label">${escHtml(m.full_name)}</span>
    </label>
  `).join('');
}

function showEmptyHousehold() {
  document.getElementById('kpi-grid').innerHTML = `
    <div class="stat-card" style="grid-column:1/-1;text-align:center;padding:var(--space-8);">
      <div class="empty-icon">🏠</div>
      <div class="empty-title" style="margin-top:var(--space-3);">Set up your household first</div>
      <div class="empty-text" style="margin:var(--space-2) auto var(--space-4);">
        Go to Settings to complete your household profile.
      </div>
      <a href="/expense-tracker/settings.html" class="btn btn-primary">Go to Settings</a>
    </div>`;
}
