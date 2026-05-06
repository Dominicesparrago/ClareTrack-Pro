let currentUser = null;
let currentAuditPage = 1;
let allSessionsCache = [];

function toast(msg, type = 'info') {
  if (window.showToast) { showToast(msg, type); return; }
  const c = document.querySelector('.toast-container') || document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.animation = 'slideOutRight 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, 3500);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

// ===== INIT =====
async function init() {
  currentUser = await checkAuth('ADMIN');
  if (!currentUser) return;

  document.getElementById('nav-user-name').textContent = currentUser.name;
  document.getElementById('nav-user-name-header').textContent = currentUser.name;
  document.getElementById('nav-avatar').textContent = getInitials(currentUser.name);

  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  });

  showPanel('overview');
}

// ===== PANEL SWITCHING =====
const PANELS = ['overview','users','subjects','sections','enrollments','sessions','auditlogs','export'];

function showPanel(name) {
  PANELS.forEach(p => {
    const el = document.getElementById(`panel-${p}`);
    if (el) el.classList.toggle('active', p === name);
  });
  document.querySelectorAll('.sidebar-link[data-panel]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === name);
  });
  loadPanel(name);
}

function loadPanel(name) {
  const loaders = {
    overview:    loadOverview,
    users:       loadUsers,
    subjects:    loadSubjects,
    sections:    loadSections,
    enrollments: loadEnrollments,
    sessions:    loadSessions,
    auditlogs:   () => loadAuditLogs(1),
    export:      loadExport
  };
  loaders[name]?.();
}

// ===== OVERVIEW =====
async function loadOverview() {
  const grid = document.getElementById('stats-grid');
  try {
    const stats = await API.get('/admin/stats');
    grid.innerHTML = `
      <div class="stat-card"><div class="stat-card__value">${stats.totalStudents}</div><div class="stat-card__label">Students</div></div>
      <div class="stat-card"><div class="stat-card__value">${stats.totalTeachers}</div><div class="stat-card__label">Professors</div></div>
      <div class="stat-card"><div class="stat-card__value">${stats.totalSubjects}</div><div class="stat-card__label">Subjects</div></div>
      <div class="stat-card"><div class="stat-card__value">${stats.totalSections}</div><div class="stat-card__label">Sections</div></div>
      <div class="stat-card"><div class="stat-card__value">${stats.totalSessions}</div><div class="stat-card__label">Total Sessions</div></div>
      <div class="stat-card"><div class="stat-card__value" style="color:var(--color-success);">${stats.finalizedSessions}</div><div class="stat-card__label">Finalized</div></div>
    `;
  } catch { grid.innerHTML = '<p style="color:var(--color-danger);">Failed to load stats.</p>'; }
}

// ===== USERS =====
function renderUserTable(users, containerId, badgeId) {
  const wrap = document.getElementById(containerId);
  const badge = document.getElementById(badgeId);
  if (badge) badge.textContent = users.length;
  if (!users.length) { wrap.innerHTML = '<p class="table-empty">None yet.</p>'; return; }
  const roleLabel = r => r === 'TEACHER' ? 'Professor' : r.charAt(0) + r.slice(1).toLowerCase();
  const rows = users.map(u => `
    <tr>
      <td>${escapeHtml(u.name)}</td>
      <td style="font-size:12px;color:var(--text-muted);">${escapeHtml(u.email)}</td>
      <td><span class="badge badge--${u.role.toLowerCase()}">${roleLabel(u.role)}</span></td>
      <td style="font-size:12px;color:var(--text-muted);">${new Date(u.created_at).toLocaleDateString('en-PH')}</td>
      <td>
        <button class="btn btn--ghost btn--sm" onclick="openUserModal(${JSON.stringify(u).replace(/"/g,'&quot;')})">Edit</button>
        ${u.id !== currentUser?.id ? `<button class="btn btn--danger btn--sm" style="margin-left:4px;" onclick="deleteUser(${u.id},'${escapeHtml(u.name)}')">Delete</button>` : ''}
      </td>
    </tr>`).join('');
  wrap.innerHTML = `
    <table class="table-clean">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function loadUsers() {
  document.getElementById('staff-table-wrap').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  document.getElementById('students-table-wrap').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const users = await API.get('/admin/users');
    const staff    = users.filter(u => u.role === 'ADMIN' || u.role === 'TEACHER');
    const students = users.filter(u => u.role === 'STUDENT');
    renderUserTable(staff,    'staff-table-wrap',    'staff-count-badge');
    renderUserTable(students, 'students-table-wrap', 'student-count-badge');
  } catch {
    document.getElementById('staff-table-wrap').innerHTML    = '<p class="table-empty" style="color:var(--color-danger);">Failed to load.</p>';
    document.getElementById('students-table-wrap').innerHTML = '<p class="table-empty" style="color:var(--color-danger);">Failed to load.</p>';
  }
}

function openUserModal(user = null) {
  document.getElementById('user-modal-id').value = user?.id || '';
  document.getElementById('user-name').value  = user?.name  || '';
  document.getElementById('user-email').value = user?.email || '';
  document.getElementById('user-password').value = '';
  document.getElementById('user-role').value  = user?.role === 'ADMIN' ? 'ADMIN' : 'TEACHER';
  document.getElementById('user-modal-title').textContent = user ? 'Edit User' : 'Add Professor / Admin';
  document.getElementById('user-password-label').innerHTML = user
    ? 'New Password <span style="font-weight:400;color:var(--color-text-muted);">(leave blank to keep current)</span>'
    : 'Password <span style="color:var(--color-danger)">*</span>';
  document.getElementById('user-modal-error').hidden = true;
  document.getElementById('user-modal').classList.add('open');
}

async function saveUser() {
  const id       = document.getElementById('user-modal-id').value;
  const name     = document.getElementById('user-name').value.trim();
  const email    = document.getElementById('user-email').value.trim();
  const password = document.getElementById('user-password').value;
  const role     = document.getElementById('user-role').value;
  const errEl    = document.getElementById('user-modal-error');
  errEl.hidden   = true;

  if (!name || !email) { errEl.textContent = 'Name and email are required.'; errEl.hidden = false; return; }
  if (!id && !password) { errEl.textContent = 'Password is required for new users.'; errEl.hidden = false; return; }

  const body = { name, email, role };
  if (password) body.password = password;

  try {
    if (id) await API.put(`/admin/users/${id}`, body);
    else    await API.post('/admin/users', body);
    closeModal('user-modal');
    toast(id ? 'User updated.' : 'User created.', 'success');
    loadUsers();
  } catch (err) {
    errEl.textContent = err.data?.error || 'Failed to save user.';
    errEl.hidden = false;
  }
}

async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"? This will also remove all their data.`)) return;
  try {
    await API.delete(`/admin/users/${id}`);
    toast('User deleted.', 'success');
    loadUsers();
  } catch (err) { toast(err.data?.error || 'Delete failed.', 'error'); }
}

// ===== SUBJECTS =====
async function loadSubjects() {
  const wrap = document.getElementById('subjects-table-wrap');
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const subjects = await API.get('/admin/subjects');
    if (!subjects.length) { wrap.innerHTML = '<p class="table-empty">No subjects found.</p>'; return; }
    const rows = subjects.map(s => `
      <tr>
        <td><strong>${escapeHtml(s.code)}</strong></td>
        <td>${escapeHtml(s.name)}</td>
        <td>${formatTime(s.time_start)} – ${formatTime(s.time_end)}</td>
        <td>${escapeHtml(s.days.replace(/,/g,', '))}</td>
        <td>${escapeHtml(s.teacher_name || '—')}</td>
        <td>
          <button class="btn btn--ghost btn--sm" onclick="openSubjectModal(${JSON.stringify(s).replace(/"/g,'&quot;')})">Edit</button>
          <button class="btn btn--danger btn--sm" style="margin-left:4px;" onclick="deleteSubject(${s.id},'${escapeHtml(s.code)}')">Delete</button>
        </td>
      </tr>`).join('');
    wrap.innerHTML = `
      <table class="table-clean">
        <thead><tr><th>Code</th><th>Name</th><th>Time</th><th>Days</th><th>Professor</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch { wrap.innerHTML = '<p class="table-empty" style="color:var(--color-danger);">Failed to load subjects.</p>'; }
}

async function openSubjectModal(subject = null) {
  document.getElementById('subject-modal-id').value      = subject?.id     || '';
  document.getElementById('subject-code').value          = subject?.code   || '';
  document.getElementById('subject-name').value          = subject?.name   || '';
  document.getElementById('subject-time-start').value    = subject?.time_start || '08:00';
  document.getElementById('subject-time-end').value      = subject?.time_end   || '09:00';
  document.getElementById('subject-days').value          = subject?.days   || '';
  document.getElementById('subject-modal-title').textContent = subject ? 'Edit Subject' : 'Add Subject';
  document.getElementById('subject-modal-error').hidden  = true;

  // Load teachers into select
  const select = document.getElementById('subject-teacher');
  select.innerHTML = '<option value="">— Select Professor —</option>';
  try {
    const users = await API.get('/admin/users');
    users.filter(u => u.role === 'TEACHER').forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      if (subject && subject.teacher_id === t.id) opt.selected = true;
      select.appendChild(opt);
    });
  } catch {}

  document.getElementById('subject-modal').classList.add('open');
}

async function saveSubject() {
  const id         = document.getElementById('subject-modal-id').value;
  const code       = document.getElementById('subject-code').value.trim();
  const name       = document.getElementById('subject-name').value.trim();
  const time_start = document.getElementById('subject-time-start').value;
  const time_end   = document.getElementById('subject-time-end').value;
  const days       = document.getElementById('subject-days').value.trim().toUpperCase();
  const teacher_id = document.getElementById('subject-teacher').value;
  const errEl      = document.getElementById('subject-modal-error');
  errEl.hidden     = true;

  if (!code || !name || !time_start || !time_end || !days || !teacher_id) {
    errEl.textContent = 'All fields are required.'; errEl.hidden = false; return;
  }

  const body = { code, name, time_start, time_end, days, teacher_id: parseInt(teacher_id) };

  try {
    if (id) await API.put(`/admin/subjects/${id}`, body);
    else    await API.post('/admin/subjects', body);
    closeModal('subject-modal');
    toast(id ? 'Subject updated.' : 'Subject created.', 'success');
    loadSubjects();
  } catch (err) {
    errEl.textContent = err.data?.error || 'Failed to save subject.';
    errEl.hidden = false;
  }
}

async function deleteSubject(id, code) {
  if (!confirm(`Delete subject "${code}"? All its sections and sessions will also be deleted.`)) return;
  try {
    await API.delete(`/admin/subjects/${id}`);
    toast('Subject deleted.', 'success');
    loadSubjects();
  } catch (err) { toast(err.data?.error || 'Delete failed.', 'error'); }
}

// ===== SECTIONS =====
async function loadSections() {
  const wrap = document.getElementById('sections-table-wrap');
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const sections = await API.get('/admin/sections');
    if (!sections.length) { wrap.innerHTML = '<p class="table-empty">No sections found.</p>'; return; }
    const rows = sections.map(s => `
      <tr>
        <td><strong>${escapeHtml(s.subject_code)}</strong></td>
        <td>${escapeHtml(s.subject_name)}</td>
        <td>${escapeHtml(s.name)}</td>
        <td><code style="background:var(--color-bg);padding:2px 8px;border-radius:4px;font-weight:700;letter-spacing:2px;">${s.join_code}</code></td>
        <td>${s.enrollment_count} students</td>
        <td>
          <button class="btn btn--danger btn--sm" onclick="deleteSection(${s.id},'${escapeHtml(s.name)}')">Delete</button>
        </td>
      </tr>`).join('');
    wrap.innerHTML = `
      <table class="table-clean">
        <thead><tr><th>Code</th><th>Subject</th><th>Section</th><th>Join Code</th><th>Enrolled</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch { wrap.innerHTML = '<p class="table-empty" style="color:var(--color-danger);">Failed to load sections.</p>'; }
}

async function openSectionModal() {
  document.getElementById('section-name').value = '';
  document.getElementById('section-join-code').value = '';
  document.getElementById('section-modal-error').hidden = true;

  const select = document.getElementById('section-subject');
  select.innerHTML = '<option value="">— Select Subject —</option>';
  try {
    const subjects = await API.get('/admin/subjects');
    subjects.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.code} – ${s.name}`;
      select.appendChild(opt);
    });
  } catch {}

  document.getElementById('section-modal').classList.add('open');
}

async function saveSection() {
  const subject_id = document.getElementById('section-subject').value;
  const name       = document.getElementById('section-name').value.trim();
  const join_code  = document.getElementById('section-join-code').value.trim().toUpperCase();
  const errEl      = document.getElementById('section-modal-error');
  errEl.hidden     = true;

  if (!subject_id || !name) { errEl.textContent = 'Subject and section name are required.'; errEl.hidden = false; return; }

  const body = { subject_id: parseInt(subject_id), name };
  if (join_code) body.join_code = join_code;

  try {
    await API.post('/admin/sections', body);
    closeModal('section-modal');
    toast('Section created.', 'success');
    loadSections();
  } catch (err) { errEl.textContent = err.data?.error || 'Failed to create section.'; errEl.hidden = false; }
}

async function deleteSection(id, name) {
  if (!confirm(`Delete section "${name}"? Enrollments and sessions will also be removed.`)) return;
  try {
    await API.delete(`/admin/sections/${id}`);
    toast('Section deleted.', 'success');
    loadSections();
  } catch (err) { toast(err.data?.error || 'Delete failed.', 'error'); }
}

// ===== ENROLLMENTS =====
async function loadEnrollments() {
  const wrap = document.getElementById('enrollments-table-wrap');
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const enrollments = await API.get('/admin/enrollments');
    if (!enrollments.length) { wrap.innerHTML = '<p class="table-empty">No enrollments found.</p>'; return; }
    const rows = enrollments.map(e => `
      <tr>
        <td>${escapeHtml(e.student_name)}</td>
        <td>${escapeHtml(e.student_email)}</td>
        <td>${escapeHtml(e.subject_code)}</td>
        <td>${escapeHtml(e.section_name)}</td>
        <td>
          <button class="btn btn--danger btn--sm" onclick="deleteEnrollment(${e.id},'${escapeHtml(e.student_name)}')">Remove</button>
        </td>
      </tr>`).join('');
    wrap.innerHTML = `
      <table class="table-clean">
        <thead><tr><th>Student</th><th>Email</th><th>Subject</th><th>Section</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch { wrap.innerHTML = '<p class="table-empty" style="color:var(--color-danger);">Failed to load enrollments.</p>'; }
}

async function openEnrollmentModal() {
  document.getElementById('enrollment-modal-error').hidden = true;

  const studentSel = document.getElementById('enroll-student');
  const sectionSel = document.getElementById('enroll-section');
  studentSel.innerHTML = '<option value="">— Select Student —</option>';
  sectionSel.innerHTML = '<option value="">— Select Section —</option>';

  try {
    const [users, sections] = await Promise.all([
      API.get('/admin/users'),
      API.get('/admin/sections')
    ]);
    users.filter(u => u.role === 'STUDENT').forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.name} (${u.email})`;
      studentSel.appendChild(opt);
    });
    sections.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.subject_code} – ${s.name}`;
      sectionSel.appendChild(opt);
    });
  } catch {}

  document.getElementById('enrollment-modal').classList.add('open');
}

async function saveEnrollment() {
  const student_id = document.getElementById('enroll-student').value;
  const section_id = document.getElementById('enroll-section').value;
  const errEl = document.getElementById('enrollment-modal-error');
  errEl.hidden = true;

  if (!student_id || !section_id) { errEl.textContent = 'Please select a student and section.'; errEl.hidden = false; return; }

  try {
    await API.post('/admin/enrollments', { student_id: parseInt(student_id), section_id: parseInt(section_id) });
    closeModal('enrollment-modal');
    toast('Student enrolled.', 'success');
    loadEnrollments();
  } catch (err) { errEl.textContent = err.data?.error || 'Failed to enroll.'; errEl.hidden = false; }
}

async function deleteEnrollment(id, name) {
  if (!confirm(`Remove enrollment for "${name}"?`)) return;
  try {
    await API.delete(`/admin/enrollments/${id}`);
    toast('Enrollment removed.', 'success');
    loadEnrollments();
  } catch (err) { toast(err.data?.error || 'Delete failed.', 'error'); }
}

// ===== SESSIONS =====
async function loadSessions() {
  const wrap = document.getElementById('sessions-table-wrap');
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  try {
    const sessions = await API.get('/admin/sessions');
    allSessionsCache = sessions;
    if (!sessions.length) { wrap.innerHTML = '<p class="table-empty">No sessions found.</p>'; return; }
    const rows = sessions.map(s => {
      const dateStr = new Date(s.created_at).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
      const status = s.finalized ? '<span class="badge badge--finalized">Finalized</span>' : '<span class="badge badge--active">Open</span>';
      return `
        <tr>
          <td>${escapeHtml(s.subject_code)}</td>
          <td>${escapeHtml(s.section_name)}</td>
          <td>${escapeHtml(s.professor_name)}</td>
          <td>${dateStr}</td>
          <td>${status}</td>
          <td>
            <span class="badge badge--present">${s.present_count}P</span>
            <span class="badge badge--absent">${s.absent_count}A</span>
            <span class="badge badge--pending">${s.pending_count}?</span>
          </td>
          <td>
            <button class="btn btn--ghost btn--sm" onclick="viewSessionRoster(${s.id},'${escapeHtml(s.subject_code)} ${escapeHtml(s.section_name)}')">View Roster</button>
          </td>
        </tr>`;
    }).join('');
    wrap.innerHTML = `
      <table class="table-clean">
        <thead><tr><th>Subject</th><th>Section</th><th>Professor</th><th>Date</th><th>Status</th><th>Stats</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch { wrap.innerHTML = '<p class="table-empty" style="color:var(--color-danger);">Failed to load sessions.</p>'; }
}

async function viewSessionRoster(sessionId, title) {
  const section = document.getElementById('session-roster-section');
  const wrap    = document.getElementById('session-roster-wrap');
  document.getElementById('roster-title').textContent = `Roster — ${title}`;
  section.classList.remove('hidden');
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  try {
    const roster = await API.get(`/admin/sessions/${sessionId}/roster`);
    if (!roster.length) { wrap.innerHTML = '<p class="table-empty">No records found.</p>'; return; }
    const rows = roster.map(r => {
      const badgeClass = { PRESENT:'badge--present', ABSENT:'badge--absent', PENDING:'badge--pending' }[r.status] || 'badge--pending';
      const timeStr = r.timestamp ? new Date(r.timestamp).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' }) : '—';
      return `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.email)}</td>
        <td><span class="badge ${badgeClass}">${r.status}</span>${r.is_manual ? ' <span style="font-size:0.7rem;color:var(--color-text-muted);">(manual)</span>' : ''}</td>
        <td>${timeStr}</td>
        <td>${r.reason ? escapeHtml(r.reason) : '—'}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `
      <table class="table-clean">
        <thead><tr><th>Student</th><th>Email</th><th>Status</th><th>Time</th><th>Reason</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    section.scrollIntoView({ behavior: 'smooth' });
  } catch { wrap.innerHTML = '<p class="table-empty" style="color:var(--color-danger);">Failed to load roster.</p>'; }
}

// ===== AUDIT LOGS =====
async function loadAuditLogs(page = 1) {
  currentAuditPage = page;
  const wrap = document.getElementById('audit-table-wrap');
  const pager = document.getElementById('audit-pagination');
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  try {
    const data = await API.get(`/admin/audit-logs?page=${page}&limit=20`);
    if (!data.logs.length) { wrap.innerHTML = '<p class="table-empty">No audit records found.</p>'; pager.innerHTML = ''; return; }

    const rows = data.logs.map(log => {
      const dateStr = new Date(log.created_at).toLocaleString('en-PH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
      return `<tr>
        <td>${dateStr}</td>
        <td>${escapeHtml(log.actor_name || '—')} <span class="badge badge--${(log.actor_role||'').toLowerCase()}" style="font-size:0.65rem;">${log.actor_role === 'TEACHER' ? 'Prof' : (log.actor_role||'')}</span></td>
        <td>${escapeHtml(log.action)}</td>
        <td>${log.student_name ? escapeHtml(log.student_name) : '—'}</td>
        <td>${log.reason ? escapeHtml(log.reason) : '—'}</td>
        <td>${log.session_id || '—'}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="table-clean">
        <thead><tr><th>Date/Time</th><th>Actor</th><th>Action</th><th>Student</th><th>Reason</th><th>Session</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    // Pagination
    const total = data.totalPages;
    let btns = '';
    if (page > 1)   btns += `<button onclick="loadAuditLogs(${page-1})">&#8592; Prev</button>`;
    for (let i = Math.max(1,page-2); i <= Math.min(total,page+2); i++) {
      btns += `<button class="${i===page?'active':''}" onclick="loadAuditLogs(${i})">${i}</button>`;
    }
    if (page < total) btns += `<button onclick="loadAuditLogs(${page+1})">Next &#8594;</button>`;
    pager.innerHTML = btns;
  } catch { wrap.innerHTML = '<p class="table-empty" style="color:var(--color-danger);">Failed to load audit logs.</p>'; }
}

// ===== EXPORT =====
async function loadExport() {
  const select = document.getElementById('export-session-select');
  select.innerHTML = '<option value="">— Loading... —</option>';
  try {
    const sessions = allSessionsCache.length ? allSessionsCache : await API.get('/admin/sessions');
    allSessionsCache = sessions;
    select.innerHTML = '<option value="">— Choose a session —</option>';
    sessions.forEach(s => {
      const dateStr = new Date(s.created_at).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.subject_code} / ${s.section_name} — ${dateStr} (${s.finalized ? 'Finalized' : 'Open'})`;
      select.appendChild(opt);
    });
  } catch { select.innerHTML = '<option value="">Failed to load sessions</option>'; }
}

function downloadExport(format = 'csv') {
  const sessionId = document.getElementById('export-session-select').value;
  const errEl = document.getElementById('export-error');
  errEl.hidden = true;
  if (!sessionId) { errEl.textContent = 'Please select a session.'; errEl.hidden = false; return; }
  if (format === 'xlsx') API.downloadExcel(sessionId);
  else API.downloadCSV(sessionId);
}

// ===== MODAL HELPERS =====
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open');
  });
});

init();
