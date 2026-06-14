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
  // Don't redirect away if the user arrived via an invite link.
  // Without this, a browser with an active session goes straight
  // to the dashboard before the invite flow ever runs.
  const hasInvite = new URLSearchParams(window.location.search).has('invite');
  if (!hasInvite) {
    await redirectIfAuthed();
  }

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
  const tabs   = document.querySelectorAll('[data-tab]');
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
    const btn      = form.querySelector('[type="submit"]');
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

  // Show/hide password toggle
  const pwToggle = document.getElementById('toggle-login-pw');
  const pwInput  = document.getElementById('login-password');
  pwToggle?.addEventListener('click', () => {
    pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
    pwToggle.textContent = pwInput.type === 'password' ? '👁️' : '🙈';
  });
}

// ============================================================
// REGISTER
// Two completely separate paths:
//   • Invite path  → account already created by Supabase when
//                    the invite was sent; just set password + join
//   • Normal path  → brand new account, create household too
// ============================================================
function initRegisterForm() {
  const form = document.getElementById('register-form');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn       = form.querySelector('[type="submit"]');
    const fullName  = form.querySelector('#reg-name').value.trim();
    const email     = form.querySelector('#reg-email').value.trim();
    const password  = form.querySelector('#reg-password').value;
    const confirm   = form.querySelector('#reg-confirm').value;
    const houseName = form.querySelector('#reg-household').value.trim();

    // ── Validation ──
    if (!fullName || !email || !password) {
      showToast('Please fill in all required fields.', 'warning'); return;
    }
    // Household name only required for normal (non-invite) signups
    if (!form._inviteToken && !houseName) {
      showToast('Please enter a household name.', 'warning'); return;
    }
    if (password !== confirm) {
      showToast('Passwords do not match.', 'error'); return;
    }
    if (password.length < 8) {
      showToast('Password must be at least 8 characters.', 'warning'); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Setting up…';

    const inviteToken     = form._inviteToken;
    const inviteHousehold = form._inviteHousehold;

    // ══════════════════════════════════════════════════════════
    // PATH A — INVITE FLOW
    // supabase.auth.admin.inviteUserByEmail() already created
    // the auth account when the invite was sent. Calling signUp()
    // again throws "already registered". Instead we:
    //   1. Grab the session the invite link auto-created
    //   2. Call updateUser() to set the chosen password
    //   3. Update the profile to link to the household
    // ══════════════════════════════════════════════════════════
    if (inviteToken && inviteHousehold) {

      // The invite email link contains Supabase auth tokens in the
      // URL hash (#access_token=…&type=invite). The Supabase JS
      // client picks these up automatically and creates a session.
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        // Tokens expired — invite link is too old
        showToast(
          'Your invite session has expired. Ask the household owner to resend the invite.',
          'error'
        );
        btn.disabled = false;
        btn.textContent = 'Join Household';
        return;
      }

      // Set the password on the pre-created account (UPDATE, not create)
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        showToast(friendlyAuthError(updateError.message), 'error');
        btn.disabled = false;
        btn.textContent = 'Join Household';
        return;
      }

      // Also persist the full name they typed
      await supabase.auth.updateUser({ data: { full_name: fullName } });

      const userId = session.user.id;

      // Mark invite as accepted in the DB
      await supabase.from('invitations')
        .update({ status: 'accepted' })
        .eq('token', inviteToken);

      // Link the profile to the household
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          household_id: inviteHousehold,
          role:         'member',
          full_name:    fullName,
        })
        .eq('id', userId);

      if (profileError) console.error('Profile update error:', profileError);

      showToast('Welcome! Your account is ready 🎉', 'success');
      setTimeout(() => window.location.href = '/expense-tracker/dashboard.html', 1500);
      return; // ← stop here; don't fall through to PATH B
    }

    // ══════════════════════════════════════════════════════════
    // PATH B — NORMAL SIGNUP FLOW
    // Brand new user with no prior account.
    // ══════════════════════════════════════════════════════════

    // 1. Create the auth account
    const { error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: 'https://gelomm.github.io/expense-tracker/dashboard.html',
      },
    });

    if (signupError) {
      showToast(friendlyAuthError(signupError.message), 'error');
      btn.disabled = false;
      btn.textContent = 'Create Account';
      return;
    }

    // 2. Sign in immediately so we have a valid session for DB writes
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Account created but email confirmation is required first
      showToast('Account created! Please verify your email then log in.', 'success');
      btn.disabled = false;
      btn.textContent = 'Create Account';
      return;
    }

    const userId = signInData.user?.id;

    // 3. Create the household
    const { data: household, error: hhError } = await supabase
      .from('households')
      .insert({ name: houseName, created_by: userId })
      .select()
      .single();

    if (hhError) {
      console.error('Household error:', hhError);
      showToast('Account created but household setup failed: ' + hhError.message, 'warning');
      btn.disabled = false;
      btn.textContent = 'Create Account';
      return;
    }

    // 4. Link profile to the new household
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ household_id: household.id, role: 'owner' })
      .eq('id', userId);

    if (profileError) console.error('Profile update error:', profileError);

    // 5. Seed a starter tag for the new household
    await seedHouseholdData(userId, household.id);

    showToast('Account created! Check your email to verify.', 'success');
    setTimeout(() => window.location.href = '/expense-tracker/dashboard.html', 1500);
  });

  // Password strength indicator
  const pwInput = document.getElementById('reg-password');
  pwInput?.addEventListener('input', () => updatePasswordStrength(pwInput.value));
}

async function seedHouseholdData(userId, householdId) {
  await supabase.from('tags').insert([
    {
      name:         'Shared',
      color:        '#4F46E5',
      is_default:   false,
      household_id: householdId,
      created_by:   userId,
    },
  ]);
}

function updatePasswordStrength(password) {
  const bar   = document.getElementById('pw-strength-bar');
  const label = document.getElementById('pw-strength-label');
  if (!bar || !label) return;

  let score = 0;
  if (password.length >= 8)          score++;
  if (password.length >= 12)         score++;
  if (/[A-Z]/.test(password))        score++;
  if (/[0-9]/.test(password))        score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const levels = [
    { width: '20%',  color: '#EF4444', label: 'Very weak' },
    { width: '40%',  color: '#F97316', label: 'Weak' },
    { width: '60%',  color: '#F59E0B', label: 'Fair' },
    { width: '80%',  color: '#10B981', label: 'Strong' },
    { width: '100%', color: '#059669', label: 'Very strong' },
  ];

  const level = levels[Math.min(score - 1, 4)] ?? levels[0];

  if (password.length === 0) {
    bar.style.width   = '0%';
    label.textContent = '';
    return;
  }

  bar.style.width      = level.width;
  bar.style.background = level.color;
  label.textContent    = level.label;
  label.style.color    = level.color;
}

// ============================================================
// FORGOT PASSWORD
// ============================================================
function initForgotPassword() {
  const link     = document.getElementById('forgot-password-link');
  const modal    = document.getElementById('forgot-modal');
  const closeBtn = document.getElementById('close-forgot-modal');
  const form     = document.getElementById('forgot-form');

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

    btn.disabled    = true;
    btn.textContent = 'Sending…';

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://gelomm.github.io/expense-tracker/settings.html#reset-password',
    });

    if (error) {
      showToast('Could not send reset email. Try again.', 'error');
    } else {
      showToast('Reset link sent! Check your email.', 'success');
      modal.classList.remove('open');
    }

    btn.disabled    = false;
    btn.textContent = 'Send Reset Link';
  });
}

// ============================================================
// INVITE TOKEN — pre-fill the register form from the URL token
// ============================================================
async function checkInviteToken() {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('invite');
  if (!token) return;

  const banner     = document.getElementById('invite-banner');
  const tokenInput = document.getElementById('invite-token-field');
  if (tokenInput) tokenInput.value = token;

  const { data: invite, error } = await supabase
    .from('invitations')
    .select('*, household:households(name), inviter:profiles(full_name)')
    .eq('token', token)
    .eq('status', 'pending')
    .single();

  if (error || !invite || new Date(invite.expires_at) < new Date()) {
    if (banner) {
      banner.innerHTML = `
        <div class="invite-card" style="background:var(--clr-danger-light);border:1px solid var(--clr-danger);border-radius:var(--radius-lg);padding:var(--space-4);">
          <div class="invite-icon">❌</div>
          <div>
            <p class="font-semibold text-danger">This invite link has expired or is invalid.</p>
            <p class="text-sm text-muted">Ask the household owner to send a new invite.</p>
          </div>
        </div>`;
      banner.classList.remove('hidden');
    }
    return;
  }

  const householdName = invite.household?.name ?? 'a household';
  const inviterName   = invite.inviter?.full_name ?? 'Someone';
  const invitedEmail  = invite.invited_email;

  // Show invite banner
  if (banner) {
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <div class="invite-card">
        <div class="invite-icon">🏠</div>
        <div>
          <p class="font-semibold">${escHtml(inviterName)} invited you to join <strong>${escHtml(householdName)}</strong></p>
          <p class="text-sm text-muted">Enter your name and a password to join. Your email is already set.</p>
        </div>
      </div>`;
  }

  // Switch to register tab
  document.querySelector('[data-tab="register"]')?.click();

  // Pre-fill and lock email
  const emailInput = document.getElementById('reg-email');
  if (emailInput) {
    emailInput.value              = invitedEmail;
    emailInput.readOnly           = true;
    emailInput.style.background   = 'var(--clr-surface-2)';
    emailInput.style.color        = 'var(--clr-text-muted)';
  }

  // Pre-fill full name from email prefix (editable)
  const nameInput = document.getElementById('reg-name');
  if (nameInput && !nameInput.value) {
    nameInput.value       = invitedEmail.split('@')[0];
    nameInput.placeholder = 'Your full name';
  }

  // Change submit button label
  const submitBtn = document.querySelector('#register-form [type="submit"]');
  if (submitBtn) submitBtn.textContent = `Join ${householdName}`;

  // Store invite metadata on the form so initRegisterForm can read it
  const form = document.getElementById('register-form');
  if (form) {
    form._inviteToken     = token;
    form._inviteHousehold = invite.household_id;
  }

  // Hide household name field — invited users join an existing one
  const houseGroup = document.getElementById('reg-household')?.closest('.form-group');
  if (houseGroup) houseGroup.style.display = 'none';
}

// ============================================================
// THEME TOGGLE
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

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}