// ============================================================
// GASTOS — Shared Utilities
// ============================================================

import { supabase, requireAuth, signOut, formatPHP, formatDate } from './supabase.js';

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message, type = 'info', duration = 3500) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon"></span><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================================
// THEME
// ============================================================
export function initTheme() {
  const saved = localStorage.getItem('gastos-theme') || 'light';
  applyTheme(saved);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('gastos-theme', theme);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next    = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

// ============================================================
// APP SHELL — Sidebar, Topbar, Mobile Nav
// ============================================================
export async function initAppShell(activePage) {
  initTheme();

  const { user, profile } = await requireAuth() ?? {};
  if (!user) return;

  // Render sidebar
  renderSidebar(activePage, profile);

  // Topbar
  const topbarTitle = document.querySelector('.topbar-title');
  const pageTitles  = {
    dashboard:  'Dashboard',
    expenses:   'Expenses',
    recurring:  'Recurring',
    splits:     'Splits & Settlements',
    reminders:  'Reminders',
    settings:   'Settings',
  };
  if (topbarTitle) topbarTitle.textContent = pageTitles[activePage] ?? 'WeXpense';

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', async () => {
    const next = toggleTheme();
    await supabase.from('profiles').update({ theme_preference: next }).eq('id', user.id);
  });

  // Notification bell
  await loadNotificationCount(user.id);

  // Mobile hamburger
  document.getElementById('hamburger-btn')?.addEventListener('click', toggleMobileSidebar);
  document.querySelector('.sidebar-overlay')?.addEventListener('click', toggleMobileSidebar);

  return { user, profile };
}

function renderSidebar(activePage, profile) {
  const navItems = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard',     href: '/expense-tracker/dashboard.html' },
    { id: 'expenses',  icon: '💸', label: 'Expenses',      href: '/expense-tracker/expenses.html' },
    { id: 'recurring', icon: '🔁', label: 'Recurring',     href: '/expense-tracker/recurring.html' },
    { id: 'splits',    icon: '👥', label: 'Splits',        href: '/expense-tracker/splits.html' },
    { id: 'reminders', icon: '🔔', label: 'Reminders',     href: '/expense-tracker/reminders.html', badge: true },
    { id: 'settings',  icon: '⚙️', label: 'Settings',      href: '/expense-tracker/settings.html' },
  ];

  const avatarInitial = (profile?.full_name ?? 'U')[0].toUpperCase();
  const householdName = profile?.household?.name ?? 'My Household';

  const sidebarEl = document.querySelector('.sidebar');
  if (!sidebarEl) return;

  sidebarEl.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-mark">W</div>
      <div>
        <div class="sidebar-logo-text">WeXpense</div>
        <div class="sidebar-logo-sub">${escHtml(householdName)}</div>
      </div>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section-label">Menu</div>
      ${navItems.map(item => `
        <a href="${item.href}" class="nav-item ${activePage === item.id ? 'active' : ''}">
          <span class="nav-item-icon">${item.icon}</span>
          <span>${item.label}</span>
          ${item.badge ? '<span class="nav-badge hidden" id="sidebar-notif-count">0</span>' : ''}
        </a>
      `).join('')}
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-user" id="sidebar-user-btn">
        <div class="avatar">${avatarInitial}</div>
        <div class="user-info">
          <div class="user-name">${escHtml(profile?.full_name ?? 'User')}</div>
          <div class="user-role">${profile?.role ?? 'member'}</div>
        </div>
        <span style="color: var(--clr-sidebar-text); font-size: 0.8rem;">⋮</span>
      </div>
    </div>
  `;

  // User dropdown
  document.getElementById('sidebar-user-btn')?.addEventListener('click', () => {
    const existingMenu = document.getElementById('user-dropdown');
    if (existingMenu) { existingMenu.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'user-dropdown';
    menu.className = 'dropdown-menu open';
    menu.style.cssText = 'position:fixed;bottom:80px;left:12px;width:200px;z-index:200;';
    menu.innerHTML = `
      <a href="/expense-tracker/settings.html" class="dropdown-item">⚙️ Settings</a>
      <div class="dropdown-divider"></div>
      <button class="dropdown-item danger" id="signout-btn">🚪 Sign Out</button>
    `;
    document.body.appendChild(menu);

    document.getElementById('signout-btn')?.addEventListener('click', signOut);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
  });

  // Mobile bottom nav
  const mobileNav = document.querySelector('.mobile-bottom-nav');
  if (mobileNav) {
    const mobileItems = navItems.slice(0, 5);
    mobileNav.innerHTML = mobileItems.map(item => `
      <button class="mobile-nav-item ${activePage === item.id ? 'active' : ''}"
              onclick="window.location='${item.href}'">
        <span class="mobile-nav-item-icon">${item.icon}</span>
        <span>${item.label}</span>
      </button>
    `).join('');
  }
}

export function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  sidebar?.classList.toggle('mobile-open');
  overlay?.classList.toggle('visible');
}

// ============================================================
// NOTIFICATION COUNT
// ============================================================
async function loadNotificationCount(userId) {
  const { count } = await supabase
    .from('reminders')
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', userId)
    .eq('is_read', false)
    .eq('is_sent', true);

  if (count > 0) {
    const badge = document.getElementById('sidebar-notif-count');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
    }
  }
}

// ============================================================
// MODAL HELPERS
// ============================================================
export function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
}

export function initModalClose(id) {
  const backdrop = document.getElementById(id);
  if (!backdrop) return;

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal(id);
  });

  backdrop.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(id));
  });
}

// ============================================================
// CONFIRM DIALOG
// ============================================================
export function confirm(message, title = 'Confirm') {
  return new Promise((resolve) => {
    const modalId = 'confirm-modal';
    let modal = document.getElementById(modalId);

    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId;
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal modal-sm">
          <div class="modal-header">
            <h3 class="modal-title" id="confirm-title">Confirm</h3>
            <button class="modal-close" id="confirm-cancel">✕</button>
          </div>
          <div class="modal-body">
            <p id="confirm-message" style="color:var(--clr-text-secondary);"></p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="confirm-cancel-btn">Cancel</button>
            <button class="btn btn-danger" id="confirm-ok-btn">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('confirm-title').textContent  = title;
    document.getElementById('confirm-message').textContent = message;

    const cleanup = (result) => {
      modal.classList.remove('open');
      document.body.style.overflow = '';
      resolve(result);
    };

    document.getElementById('confirm-ok-btn').onclick     = () => cleanup(true);
    document.getElementById('confirm-cancel-btn').onclick = () => cleanup(false);
    document.getElementById('confirm-cancel').onclick     = () => cleanup(false);

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
}

// ============================================================
// MONTH FILTER
// ============================================================
export function initMonthFilter(onchange) {
  const sel = document.getElementById('month-filter');
  if (!sel) return;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Populate last 12 months + next 2 months
  const months = [];
  for (let i = -12; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    months.push({ val, label });
  }

  sel.innerHTML = months.map(m =>
    `<option value="${m.val}" ${m.val === currentMonth ? 'selected' : ''}>${m.label}</option>`
  ).join('');

  sel.addEventListener('change', () => onchange(sel.value));
  return currentMonth;
}

// ============================================================
// CATEGORY COLOR ICON HELPER
// ============================================================
export function categoryBadge(category) {
  if (!category) return '<span class="badge badge-neutral">Uncategorized</span>';
  return `
    <span class="badge" style="background:${hexToAlpha(category.color, 0.15)};color:${category.color}">
      ${category.icon} ${escHtml(category.name)}
    </span>
  `;
}

export function tagBadge(tag) {
  if (!tag) return '';
  return `
    <span class="tag" style="background:${hexToAlpha(tag.color, 0.15)};color:${tag.color};border-color:${hexToAlpha(tag.color, 0.3)}">
      ${escHtml(tag.name)}
    </span>
  `;
}

// ============================================================
// DATA EXPORT
// ============================================================
export function exportJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

export function exportCSV(rows, headers, filename) {
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// MISC HELPERS
// ============================================================
export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function hexToAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function pluralize(count, word) {
  return `${count} ${word}${count !== 1 ? 's' : ''}`;
}

export function daysLabel(n) {
  if (n === 0)  return 'Today';
  if (n === 1)  return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0)    return `${Math.abs(n)} days overdue`;
  return `In ${n} days`;
}

export function frequencyLabel(f) {
  const map = {
    daily: 'Daily', weekly: 'Weekly', biweekly: 'Bi-weekly',
    monthly: 'Monthly', bimonthly: 'Bi-monthly', annually: 'Annually',
  };
  return map[f] ?? f;
}

// Re-export from supabase for convenience
export { formatPHP, formatDate };
