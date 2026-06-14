// ============================================================
// GASTOS — Auth Module
// Handles: login, register, forgot password, invite acceptance
// ============================================================

import { supabase, redirectIfAuthed } from './supabase.js';
import { showToast } from './utils.js';

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await redirectIfAuthed();
  initTabs();
  initLoginForm();
  initRegisterForm();
  initForgotPassword();
  checkInviteToken();
  initThemeToggle();
});

// ============================================================
// TABS (Login / Register)
// ============================================================
function initTabs() {
  const tabs = document.querySelectorAll('[data-tab]');
  const panels = document.querySelectorAll('[data-panel]');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      document.querySelector(`[data-panel="${target}"]`)?.classList.remove('hidden');
    });
  });
}

// ============================================================
// LOGIN
// ============================================================
function initLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const email    = form.querySelector('#login-email').value.trim();
    const password = form.querySelector('#login-password').value;

    if (!email || !password) {
      showToast('Please fill in all fields.', 'warning');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Signing in…';

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showToast(friendlyAuthError(error.message), 'error');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    } else {
      window.location.href = '/expense-tracker/dashboard.html';
    }
  });

  // Show/hide password
  const pwToggle = document.getElementById('toggle-login-pw');
  const pwInput  = document.getElementById('login-password');
  pwToggle?.addEventListener('click', () => {
    pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
    pwToggle.textContent = pwInput.type === 'password' ? '👁️' : '🙈';
  });
}

// ============================================================
// REGISTER
// ============================================================
function initRegisterForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn         = form.querySelector('[type="submit"]');
    const fullName    = form.querySelector('#reg-name').value.trim();
    const email       = form.querySelector('#reg-email').value.trim();
    const password    = form.querySelector('#reg-password').value;
    const confirm     = form.querySelector('#reg-confirm').value;
    const houseName   = form.querySelector('#reg-household').value.trim();

    if (!fullName || !email || !password || !houseName) {
      showToast('Please fill in all required fields.', 'warning'); return;
    }
    if (password !== confirm) {
      showToast('Passwords do not match.', 'error'); return;
    }
    if (password.length < 8) {
      showToast('Password must be at least 8 characters.', 'warning'); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating account…';

    // 1. Sign up user
    const { data: authData, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: { 
        data: { full_name: fullName },
        emailRedirectTo: 'https://gelomm.github.io/expense-tracker/dashboard.html'
    },
    });

    if (signupError) {
      showToast(friendlyAuthError(signupError.message), 'error');
      btn.disabled = false;
      btn.textContent = 'Create Account';
      return;
    }

    const userId = authData.user?.id;

    // 2. Create household
    const { data: household, error: hhError } = await supabase
      .from('households')
      .insert({ name: houseName, created_by: userId })
      .select().single();

    if (hhError) {
      onsole.error('Household error:', hhError);
      showToast('Account created but could not set up household. Please log in.', 'warning');
    } else {
      // 3. Update profile with household
      await supabase.from('profiles').update({
        household_id: household.id,
        role: 'owner',
      }).eq('id', userId);

      // 4. Seed household-specific default categories from global
      await seedHouseholdCategories(userId, household.id);
    }

    showToast('Account created! Check your email to verify.', 'success');
    setTimeout(() => window.location.href = '/expense-tracker/dashboard.html', 1500);
  });

  // Password strength
  const pwInput = document.getElementById('reg-password');
  pwInput?.addEventListener('input', () => updatePasswordStrength(pwInput.value));
}

async function seedHouseholdCategories(userId, householdId) {
  // Categories with null household_id are global defaults
  // They're already shared, no need to duplicate.
  // This function can be used to seed custom starter tags.
  await supabase.from('tags').insert([
    { name: 'Shared', color: '#4F46E5', is_default: false, household_id: householdId, created_by: userId },
  ]).select();
}

function updatePasswordStrength(password) {
  const bar   = document.getElementById('pw-strength-bar');
  const label = document.getElementById('pw-strength-label');
  if (!bar || !label) return;

  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { width: '20%', color: '#EF4444', label: 'Very weak' },
    { width: '40%', color: '#F97316', label: 'Weak' },
    { width: '60%', color: '#F59E0B', label: 'Fair' },
    { width: '80%', color: '#10B981', label: 'Strong' },
    { width: '100%', color: '#059669', label: 'Very strong' },
  ];

  const level = levels[Math.min(score - 1, 4)] ?? levels[0];
  if (password.length === 0) { bar.style.width = '0%'; label.textContent = ''; return; }
  bar.style.width = level.width;
  bar.style.background = level.color;
  label.textContent = level.label;
  label.style.color = level.color;
}

// ============================================================
// FORGOT PASSWORD
// ============================================================
function initForgotPassword() {
  const link = document.getElementById('forgot-password-link');
  const modal = document.getElementById('forgot-modal');
  const closeBtn = document.getElementById('close-forgot-modal');
  const form = document.getElementById('forgot-form');

  link?.addEventListener('click', (e) => {
    e.preventDefault();
    modal?.classList.add('open');
  });

  closeBtn?.addEventListener('click', () => modal?.classList.remove('open'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('#forgot-email').value.trim();
    const btn   = form.querySelector('[type="submit"]');

    btn.disabled = true;
    btn.textContent = 'Sending…';

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `https://gelomm.github.io/expense-tracker/settings.html#reset-password`,
    });

    if (error) {
      showToast('Could not send reset email. Try again.', 'error');
    } else {
      showToast('Reset link sent! Check your email.', 'success');
      modal.classList.remove('open');
    }

    btn.disabled = false;
    btn.textContent = 'Send Reset Link';
  });
}

// ============================================================
// INVITE TOKEN — Accept an invite from URL
// ============================================================
async function checkInviteToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('invite');
  if (!token) return;

  const banner = document.getElementById('invite-banner');
  const tokenInput = document.getElementById('invite-token-field');
  if (banner)     banner.classList.remove('hidden');
  if (tokenInput) tokenInput.value = token;

  // Fetch invite info
  const { data: invite } = await supabase
    .from('invitations')
    .select('*, household:households(name), inviter:profiles(full_name)')
    .eq('token', token)
    .eq('status', 'pending')
    .single();

  if (!invite || new Date(invite.expires_at) < new Date()) {
    if (banner) banner.innerHTML = '<p class="text-danger">This invite link has expired or is invalid.</p>';
    return;
  }

  const householdName = invite.household?.name ?? 'a household';
  const inviterName   = invite.inviter?.full_name ?? 'Someone';

  if (banner) {
    banner.innerHTML = `
      <div class="invite-card">
        <div class="invite-icon">🏠</div>
        <div>
          <p class="font-semibold">${inviterName} invited you to join <strong>${householdName}</strong></p>
          <p class="text-sm text-muted">Create an account or sign in to accept.</p>
        </div>
      </div>
    `;
  }

  // Pre-fill register email
  const emailInput = document.getElementById('reg-email');
  if (emailInput && invite.invited_email) {
    emailInput.value = invite.invited_email;
  }

  // After auth, process invite
  supabase.auth.onAuthStateChange(async (event, session) => {
    if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session) {
      await acceptInvite(token, session.user.id);
    }
  });
}

async function acceptInvite(token, userId) {
  const { data: invite } = await supabase
    .from('invitations')
    .select('*')
    .eq('token', token)
    .eq('status', 'pending')
    .single();

  if (!invite) return;

  await supabase.from('profiles').update({
    household_id: invite.household_id,
    role: 'member',
  }).eq('id', userId);

  await supabase.from('invitations').update({ status: 'accepted' }).eq('id', invite.id);

  window.location.href = '/expense-tracker/dashboard.html';
}

// ============================================================
// THEME TOGGLE on auth page
// ============================================================
function initThemeToggle() {
  const savedTheme = localStorage.getItem('gastos-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const toggle = document.getElementById('auth-theme-toggle');
  if (toggle) {
    toggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next    = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('gastos-theme', next);
      toggle.textContent = next === 'dark' ? '☀️' : '🌙';
    });
  }
}

// ============================================================
// HELPERS
// ============================================================
function friendlyAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return 'Incorrect email or password.';
  if (msg.includes('Email not confirmed'))       return 'Please verify your email first.';
  if (msg.includes('already registered'))        return 'This email is already registered. Try logging in.';
  if (msg.includes('Password should be'))        return 'Password must be at least 8 characters.';
  return msg;
}
