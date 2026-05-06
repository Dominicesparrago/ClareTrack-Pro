const API = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(`/api${path}`, opts);

    if (res.status === 401) {
      if (!window.location.pathname.includes('login') && !window.location.pathname.includes('signup')) {
        window.location.href = '/login.html';
      }
      return Promise.reject({ status: 401, error: 'Not authenticated' });
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    }

    return data;
  },

  get(path)        { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body)  { return this.request('PUT', path, body); },
  delete(path)     { return this.request('DELETE', path); },

  downloadCSV(sessionId) {
    window.location.href = `/api/admin/export/${sessionId}`;
  }
};

window.API = API;

/* ── Toast helper ── */
function showToast(message, type = 'info', duration = 3500) {
  const icons = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    info:    'fa-circle-info',
    warning: 'fa-triangle-exclamation'
  };

  // Prefer new .toast-container, fall back to legacy #toast-container
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
  }

  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(t);

  setTimeout(() => {
    t.style.animation = 'slideOutRight 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, duration);
}

window.showToast = showToast;
