/* ── Theme ── */
(function () {
  const saved = localStorage.getItem('claretrack-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

function applyThemeIcon() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  document.querySelectorAll('#theme-icon').forEach(i => {
    i.className = current === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  });
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('claretrack-theme', next);
  applyThemeIcon();
}

window.toggleTheme = toggleTheme;

/* Run icon update after DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyThemeIcon);
} else {
  applyThemeIcon();
}

/* ── Role routing ── */
const ROLE_PAGES = {
  ADMIN:   '/dashboard-admin.html',
  TEACHER: '/dashboard-teacher.html',
  STUDENT: '/dashboard-student.html'
};

async function checkAuth(expectedRole) {
  try {
    const user = await API.get('/auth/me');
    if (expectedRole && user.role !== expectedRole) {
      window.location.href = ROLE_PAGES[user.role] || '/login.html';
      return null;
    }
    return user;
  } catch {
    window.location.href = '/login.html';
    return null;
  }
}

/* ── Nav helpers ── */
function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function hideError(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.hidden = true;
}

function populateNav(user) {
  const nameEl = document.getElementById('nav-user-name');
  const roleEl = document.getElementById('nav-user-role');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) {
    const label = user.role === 'TEACHER' ? 'Professor' : user.role;
    roleEl.textContent = label;
    roleEl.className = `badge badge-role badge--${user.role.toLowerCase()}`;
  }
}

async function logout() {
  try { await API.post('/auth/logout'); } finally {
    window.location.href = '/login.html';
  }
}

/* ── Login form ── */
const loginForm = document.getElementById('login-form');
if (loginForm) {
  API.get('/auth/me').then(user => {
    window.location.href = ROLE_PAGES[user.role] || '/login.html';
  }).catch(() => {});

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('login-error');
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn      = loginForm.querySelector('button[type="submit"]');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing in…';

    try {
      const user = await API.post('/auth/login', { email, password });
      window.location.href = ROLE_PAGES[user.role] || '/login.html';
    } catch (err) {
      showError('login-error', err.data?.error || 'Invalid email or password');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Sign In';
    }
  });
}

/* ── Signup form ── */
const signupForm = document.getElementById('signup-form');
if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('signup-error');
    const name     = document.getElementById('name').value.trim();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirm  = document.getElementById('confirm-password').value;

    if (password !== confirm) { showError('signup-error', 'Passwords do not match'); return; }
    if (password.length < 8)  { showError('signup-error', 'Password must be at least 8 characters'); return; }

    const btn = signupForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating account…';

    try {
      await API.post('/auth/signup', { name, email, password });
      window.location.href = '/dashboard-student.html';
    } catch (err) {
      showError('signup-error', err.data?.error || 'Registration failed');
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Create Account';
    }
  });
}

window.checkAuth   = checkAuth;
window.populateNav = populateNav;
window.logout      = logout;
