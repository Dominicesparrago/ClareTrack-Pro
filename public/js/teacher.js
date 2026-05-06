let currentUser      = null;
let activeSessionId  = null;
let activeSectionId  = null;
let countdownInterval = null;
let allSubjectsCache = [];
let studentsCache    = [];

/* ── Toast bridge (uses showToast from api.js, falls back to legacy) ── */
function toast(msg, type = 'info') {
  if (window.showToast) { showToast(msg, type); return; }
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 300); }, 3500);
}

/* ── Formatters ── */
function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}
function formatDays(days) {
  const map = { MON:'Mon', TUE:'Tue', WED:'Wed', THU:'Thu', FRI:'Fri', SAT:'Sat', SUN:'Sun' };
  return days.split(',').map(d => map[d.trim()] || d).join(', ');
}
function getInitials(name) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase();
}
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── INIT ── */
async function init() {
  currentUser = await checkAuth('TEACHER');
  if (!currentUser) return;

  document.getElementById('nav-user-name').textContent = currentUser.name;
  document.getElementById('nav-user-name-header').textContent = currentUser.name;
  document.getElementById('nav-avatar').textContent = getInitials(currentUser.name);

  const socket = initSocket();
  socket.on('attendance_update', onAttendanceUpdate);
  socket.on('session_finalized', onSessionFinalized);
  socket.on('session_expired',   onSessionExpired);

  await loadTodaySubjects();

  document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
}

/* ── PANEL SWITCHING ── */
function switchPanel(name) {
  const panels = ['today', 'all', 'students', 'history'];
  panels.forEach(p => {
    const el = document.getElementById(`panel-${p}`);
    if (el) el.classList.toggle('hidden', p !== name);
  });
  document.querySelectorAll('.sidebar-link[id^="nav-"]').forEach(l => l.classList.remove('active'));
  const navEl = document.getElementById(`nav-${name}`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    today:    "Today's Classes",
    all:      'All Subjects',
    students: 'Students',
    history:  'Session History'
  };
  document.getElementById('topnav-title').textContent = titles[name] || 'Professor Dashboard';

  if (name === 'today')    loadTodaySubjects();
  if (name === 'all')      loadAllSubjects();
  if (name === 'students') loadStudentsPanel();
  if (name === 'history')  loadSessionHistory();
}

/* ══════════════════════════════
   TODAY'S CLASSES
══════════════════════════════ */
async function loadTodaySubjects() {
  const list = document.getElementById('subjects-list');
  list.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  document.getElementById('today-stats').innerHTML = '';

  try {
    const subjects = await API.get('/teacher/subjects');
    allSubjectsCache = subjects;

    // Build today stats
    let totalSessions = 0, totalPresent = 0, totalAbsent = 0;
    subjects.forEach(sub => sub.sections.forEach(sec => {
      if (sec.session) {
        totalSessions++;
        // We'd need counts — approximate from finalized
      }
    }));
    renderTodayStats(subjects);

    if (!subjects.length) {
      list.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-calendar-days"></i>
          <div class="empty-state__title">No Classes Today</div>
          <div class="empty-state__text">You have no subjects scheduled for today.</div>
        </div>`;
      return;
    }

    renderSubjectCards(subjects, list);
    subjects.forEach(sub => sub.sections.forEach(sec => joinSection(sec.id)));
  } catch {
    list.innerHTML = `<div class="empty-state"><div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load subjects.</div></div>`;
  }
}

function renderTodayStats(subjects) {
  const statsEl = document.getElementById('today-stats');
  let sessions = 0, present = 0, absent = 0;
  subjects.forEach(sub => sub.sections.forEach(sec => {
    if (sec.session) sessions++;
  }));

  statsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue"><i class="fa-solid fa-calendar-days"></i></div>
      <div class="stat-label">Today's Sessions</div>
      <div class="stat-value" style="font-family:var(--font-display);">${sessions}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon blue"><i class="fa-solid fa-book"></i></div>
      <div class="stat-label">Subjects Scheduled</div>
      <div class="stat-value" style="font-family:var(--font-display);">${subjects.length}</div>
    </div>`;
}

function renderSubjectCards(subjects, container, readOnly = false) {
  container.innerHTML = subjects.map(sub => {
    const sectionBlocks = sub.sections.map(sec => {
      const sess = sec.session;
      let badgeHtml, btnHtml;

      if (!sess) {
        badgeHtml = `<span class="badge badge-pending"><i class="fa-solid fa-circle-minus"></i> No Session</span>`;
        btnHtml   = `<button class="btn btn-primary btn-sm" onclick="requestAttendance(${sec.id}, ${sub.id})">
                       <i class="fa-solid fa-circle-dot"></i> Request Attendance
                     </button>`;
      } else if (sess.finalized) {
        badgeHtml = `<span class="badge badge-finalized"><i class="fa-solid fa-lock"></i> Finalized</span>`;
        btnHtml   = `<button class="btn btn-ghost btn-sm" onclick="viewSession(${sess.id}, ${sec.id}, '${escapeHtml(sub.name)}', '${escapeHtml(sec.name)}')">
                       <i class="fa-solid fa-clipboard-list"></i> View Roster
                     </button>`;
      } else {
        badgeHtml = `<span class="badge badge-active"><span class="pulse-dot"></span> Active Session</span>`;
        btnHtml   = `<button class="btn btn-secondary btn-sm" onclick="viewSession(${sess.id}, ${sec.id}, '${escapeHtml(sub.name)}', '${escapeHtml(sec.name)}')">
                       <i class="fa-solid fa-eye"></i> View Session
                     </button>`;
      }

      return readOnly ? '' : `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <span style="font-size:12px;color:var(--text-muted);">
              <i class="fa-solid fa-layer-group" style="margin-right:4px;"></i>${escapeHtml(sec.name)}
              &bull; <span style="font-family:var(--font-mono);letter-spacing:0.1em;">${sec.join_code}</span>
            </span>
            ${badgeHtml}
          </div>
          ${btnHtml}
        </div>`;
    }).join('');

    const enrolledHint = sub.sections.length
      ? `<span class="subject-card__pill"><i class="fa-solid fa-users" style="margin-right:3px;"></i>${sub.sections.length} section${sub.sections.length > 1 ? 's' : ''}</span>`
      : '';

    return `
      <div class="subject-card" id="subj-card-${sub.id}">
        <div class="subject-card__code">${escapeHtml(sub.code)}</div>
        <div class="subject-card__name">${escapeHtml(sub.name)}</div>
        <div class="subject-card__meta">
          <i class="fa-solid fa-clock" style="margin-right:4px;opacity:.6;"></i>${formatTime(sub.time_start)} – ${formatTime(sub.time_end)}
          &nbsp;&bull;&nbsp;
          <i class="fa-solid fa-calendar-days" style="margin-right:4px;opacity:.6;"></i>${formatDays(sub.days)}
        </div>
        ${enrolledHint}
        ${sectionBlocks}
      </div>`;
  }).join('');
}

/* ══════════════════════════════
   ALL SUBJECTS
══════════════════════════════ */
async function loadAllSubjects() {
  const list = document.getElementById('all-subjects-list');
  list.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  try {
    const subjects = await API.get('/teacher/subjects/all');
    if (!subjects.length) {
      list.innerHTML = `<div class="empty-state"><i class="fa-solid fa-book"></i><div class="empty-state__title">No Subjects Assigned</div></div>`;
      return;
    }
    const wrapped = subjects.map(s => ({ ...s, sections: [] }));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;';
    list.innerHTML = '';
    list.appendChild(grid);
    renderSubjectCards(wrapped, grid, true);
  } catch {
    list.innerHTML = `<div class="empty-state"><div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load subjects.</div></div>`;
  }
}

/* ══════════════════════════════
   REQUEST / VIEW SESSION
══════════════════════════════ */
async function requestAttendance(sectionId) {
  try {
    const result = await API.post('/attendance/start', { sectionId });
    toast('Attendance session started!', 'success');
    await loadTodaySubjects();
    const sub = allSubjectsCache.find(s => s.sections.some(sec => sec.id === sectionId));
    const sec = sub?.sections.find(s => s.id === sectionId);
    if (sec && result.sessionId) viewSession(result.sessionId, sectionId, sub.name, sec.name);
  } catch (err) {
    const msg = err.data?.error || 'Failed to start session';
    toast(msg, 'error');
    if (err.status === 409) await loadTodaySubjects();
  }
}

async function viewSession(sessionId, sectionId, subjectName, sectionName) {
  activeSessionId = sessionId;
  activeSectionId = sectionId;
  clearInterval(countdownInterval);

  document.getElementById('session-placeholder').classList.add('hidden');
  const panel = document.getElementById('session-panel');
  panel.classList.remove('hidden');
  panel.innerHTML = '<div class="loading-center" style="min-height:300px;"><div class="spinner"></div></div>';

  try {
    const { session, roster } = await API.get(`/teacher/roster/${sessionId}`);
    renderSessionPanel(session, roster, subjectName || '', sectionName || '');
    joinSection(sectionId);
  } catch {
    panel.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load session.</div></div>`;
  }
}

function renderSessionPanel(session, roster, subjectName, sectionName) {
  const panel = document.getElementById('session-panel');
  const isFinalized = session.finalized === 1;
  const isExpired   = Date.now() >= new Date(session.expires_at).getTime();

  if (isFinalized) {
    panel.innerHTML = `
      <div class="finalized-banner" style="margin-bottom:16px;">
        <h3><i class="fa-solid fa-lock" style="margin-right:8px;"></i>Session Finalized</h3>
        <p>This session has been locked. The roster below is the final record.</p>
      </div>
      ${buildRosterTable(roster, session.id, true)}`;
    return;
  }

  const presentCount = roster.filter(r => r.status === 'PRESENT').length;
  const absentCount  = roster.filter(r => r.status === 'ABSENT').length;
  const pendingCount = roster.filter(r => r.status === 'PENDING' || !r.status).length;

  panel.innerHTML = `
    <div class="session-panel">
      <div class="session-panel-header">
        <div class="session-info">
          <h3>${escapeHtml(subjectName)}</h3>
          <p><i class="fa-solid fa-layer-group" style="margin-right:4px;"></i>${escapeHtml(sectionName)}
             &nbsp;&bull;&nbsp;
             ${isExpired
               ? '<span style="color:var(--status-absent-text);"><i class="fa-solid fa-clock"></i> Expired</span>'
               : '<span style="color:var(--status-present-text);"><span class="pulse-dot" style="margin-right:4px;"></span>Active</span>'}
          </p>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
            <span class="badge badge-present"><i class="fa-solid fa-circle-check"></i> ${presentCount} Present</span>
            <span class="badge badge-absent"><i class="fa-solid fa-circle-xmark"></i> ${absentCount} Absent</span>
            <span class="badge badge-pending"><i class="fa-solid fa-circle-minus"></i> ${pendingCount} Pending</span>
          </div>
          ${!isExpired ? `
          <div class="countdown-wrap" id="countdown-wrap">
            <i class="fa-solid fa-hourglass-half" style="color:var(--accent);font-size:13px;"></i>
            <span class="countdown-timer" id="countdown-text">15:00</span>
            <div class="countdown-bar"><div class="countdown-bar-fill" id="countdown-fill" style="width:100%;"></div></div>
          </div>` : ''}
        </div>
      </div>
      ${isExpired ? `<div class="session-expired-notice" style="margin:0 20px 0;">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>
        Session window has passed. Finalize to lock the record.
      </div>` : ''}
      <div class="session-panel-body" id="roster-container">
        ${buildRosterTable(roster, session.id, false)}
      </div>
      <div class="session-panel-footer">
        <button class="btn btn-danger" onclick="openFinalizeModal(${session.id})" id="finalize-btn">
          <i class="fa-solid fa-lock"></i> Finalize Session
        </button>
      </div>
    </div>`;

  if (!isExpired) startCountdown(session.expires_at, session.created_at);
}

function buildRosterTable(roster, sessionId, readOnly) {
  if (!roster.length) {
    return `<div class="empty-state"><i class="fa-solid fa-users"></i><div class="empty-state__title">No Students Enrolled</div></div>`;
  }

  const rows = roster.map(s => {
    const status = s.status || 'PENDING';
    const badgeCls = { PRESENT: 'badge-present', ABSENT: 'badge-absent', PENDING: 'badge-pending' }[status] || 'badge-pending';
    const icon     = { PRESENT: 'fa-circle-check', ABSENT: 'fa-circle-xmark', PENDING: 'fa-circle-minus' }[status] || 'fa-circle-minus';
    const timeStr  = s.timestamp ? new Date(s.timestamp).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }) : '—';
    const manualTag = s.is_manual
      ? ` <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">(manual)</span>`
      : '';
    const actionBtn = readOnly ? '' : `
      <button class="btn btn-ghost btn-sm" onclick="openOverrideModal(${sessionId}, ${s.id}, '${escapeHtml(s.name)}')">
        <i class="fa-solid fa-pen-to-square"></i>
      </button>`;

    return `
      <tr data-student-id="${s.id}">
        <td>
          <div class="student-name">${escapeHtml(s.name)}${manualTag}</div>
          <div class="student-email">${escapeHtml(s.email || '')}</div>
        </td>
        <td><span class="badge ${badgeCls} student-status-badge"><i class="fa-solid ${icon}"></i> ${status}</span></td>
        <td class="student-timestamp" style="font-family:var(--font-mono);font-size:13px;">${timeStr}</td>
        ${readOnly ? '' : `<td>${actionBtn}</td>`}
      </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="table-clean">
        <thead><tr>
          <th>Student</th>
          <th>Status</th>
          <th>Time Marked</th>
          ${readOnly ? '' : '<th></th>'}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ── Countdown bar ── */
function startCountdown(expiresAt, createdAt) {
  clearInterval(countdownInterval);
  const totalMs  = new Date(expiresAt).getTime() - new Date(createdAt).getTime();

  function tick() {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    const textEl   = document.getElementById('countdown-text');
    const fillEl   = document.getElementById('countdown-fill');
    if (!textEl) { clearInterval(countdownInterval); return; }

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      textEl.textContent = '0:00';
      textEl.classList.add('urgent');
      if (fillEl) { fillEl.style.width = '0%'; fillEl.classList.add('urgent'); }

      // Insert expired notice if not already there
      const header = document.querySelector('.session-panel-header');
      if (header && !document.querySelector('.session-expired-notice')) {
        const notice = document.createElement('div');
        notice.className = 'session-expired-notice';
        notice.style.margin = '0 20px';
        notice.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>Session window has passed. Finalize to lock the record.';
        header.after(notice);
      }
      return;
    }

    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    textEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
    if (fillEl) fillEl.style.width = `${pct.toFixed(1)}%`;

    if (remaining < 3 * 60 * 1000) {
      textEl.classList.add('urgent');
      if (fillEl) fillEl.classList.add('urgent');
    }
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

/* ══════════════════════════════
   STUDENTS PANEL
══════════════════════════════ */
async function loadStudentsPanel() {
  const wrap = document.getElementById('students-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  // Populate subject filter on first load
  const subjectFilter  = document.getElementById('students-subject-filter');
  const sectionFilter  = document.getElementById('students-section-filter');
  const subjectId = subjectFilter?.value || '';
  const sectionId = sectionFilter?.value || '';

  // First time: populate subject dropdown from cache or API
  if (subjectFilter && subjectFilter.options.length <= 1) {
    try {
      const subjects = await API.get('/teacher/subjects/all');
      subjects.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.code} — ${s.name}`;
        subjectFilter.appendChild(opt);
      });
    } catch {}
  }

  const params = new URLSearchParams();
  if (subjectId) params.set('subjectId', subjectId);
  if (sectionId) params.set('sectionId', sectionId);

  try {
    const students = await API.get(`/teacher/students?${params}`);
    studentsCache  = students;

    if (!students.length) {
      wrap.innerHTML = `<div class="empty-state">
        <i class="fa-solid fa-users"></i>
        <div class="empty-state__title">No Students Found</div>
        <div class="empty-state__text">Try adjusting the filters above.</div>
      </div>`;
      return;
    }

    renderStudentsTable(students, wrap);
  } catch {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load students.</div></div>`;
  }
}

async function onStudentFilterChange() {
  const subjectId = document.getElementById('students-subject-filter')?.value || '';
  const sectionSel = document.getElementById('students-section-filter');

  // Reset section filter and repopulate
  sectionSel.innerHTML = '<option value="">All Sections</option>';

  if (subjectId) {
    try {
      const sections = await API.get(`/teacher/sections/${subjectId}`);
      sections.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        sectionSel.appendChild(opt);
      });
    } catch {}
  }

  await loadStudentsPanel();
}

function renderStudentsTable(students, wrap) {
  const rows = students.map((s, idx) => {
    const pct = s.total_sessions > 0 ? Math.round((s.present_count / s.total_sessions) * 100) : 0;
    const rateClass = pct >= 75 ? 'high' : pct >= 50 ? 'medium' : 'low';
    const lastSeen  = s.last_seen ? new Date(s.last_seen).toLocaleDateString('en-PH', { month:'short', day:'numeric' }) : '—';

    return `
      <tr style="cursor:pointer;" onclick="openStudentDrawer(${s.id}, '${escapeHtml(s.name)}')">
        <td style="font-size:13px;color:var(--text-muted);width:40px;">${idx + 1}</td>
        <td>
          <div class="student-name">${escapeHtml(s.name)}</div>
          <div class="student-email">${escapeHtml(s.email)}</div>
        </td>
        <td style="font-size:13px;color:var(--text-muted);">${escapeHtml(s.section_name || '—')}</td>
        <td style="min-width:140px;">
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:4px;">
            <span style="color:var(--text-muted);">${s.present_count}/${s.total_sessions} sessions</span>
            <span style="font-weight:600;color:var(--text-primary);">${pct}%</span>
          </div>
          <div class="rate-bar"><div class="rate-bar-fill ${rateClass}" style="width:${pct}%;"></div></div>
        </td>
        <td style="font-size:13px;color:var(--text-muted);">${lastSeen}</td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="table-clean" id="students-table">
      <thead><tr>
        <th>#</th>
        <th>Student</th>
        <th>Section</th>
        <th>Attendance Rate</th>
        <th>Last Seen</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function filterStudentsTable() {
  const q = (document.getElementById('students-search')?.value || '').toLowerCase();
  document.querySelectorAll('#students-table tbody tr').forEach(tr => {
    const name = tr.querySelector('.student-name')?.textContent.toLowerCase() || '';
    tr.style.display = name.includes(q) ? '' : 'none';
  });
}

async function openStudentDrawer(studentId, studentName) {
  document.getElementById('drawer-student-name').textContent = studentName;
  document.getElementById('drawer-body').innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  document.getElementById('student-drawer-overlay').classList.add('open');

  try {
    const records = await API.get(`/teacher/student/${studentId}/history`);

    if (!records.length) {
      document.getElementById('drawer-body').innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <div class="empty-state__title">No Records</div>
          <div class="empty-state__text">No attendance sessions recorded yet.</div>
        </div>`;
      return;
    }

    const total   = records.length;
    const present = records.filter(r => r.status === 'PRESENT').length;
    const absent  = records.filter(r => r.status === 'ABSENT').length;
    const pct     = total > 0 ? Math.round((present / total) * 100) : 0;
    const rateClass = pct >= 75 ? 'high' : pct >= 50 ? 'medium' : 'low';

    const rows = records.map(r => {
      const date = new Date(r.session_date).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
      const time = r.timestamp ? new Date(r.timestamp).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' }) : '—';
      const cls  = { PRESENT:'badge-present', ABSENT:'badge-absent', PENDING:'badge-pending' }[r.status] || 'badge-pending';
      const icon = { PRESENT:'fa-circle-check', ABSENT:'fa-circle-xmark', PENDING:'fa-circle-minus' }[r.status] || 'fa-circle-minus';
      return `<tr>
        <td style="font-size:13px;">${date}</td>
        <td style="font-size:13px;color:var(--text-muted);">${escapeHtml(r.subject_code)}</td>
        <td><span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${r.status}</span></td>
        <td style="font-size:12px;font-family:var(--font-mono);">${time}</td>
      </tr>`;
    }).join('');

    document.getElementById('drawer-body').innerHTML = `
      <div class="grid-stats" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
        <div class="stat-card" style="padding:14px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Total</div>
          <div style="font-family:var(--font-display);font-size:22px;font-weight:700;">${total}</div>
        </div>
        <div class="stat-card" style="padding:14px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Present</div>
          <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--status-present-text);">${present}</div>
        </div>
        <div class="stat-card" style="padding:14px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Absent</div>
          <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--status-absent-text);">${absent}</div>
        </div>
        <div class="stat-card" style="padding:14px;">
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">Rate</div>
          <div style="font-family:var(--font-display);font-size:22px;font-weight:700;">${pct}%</div>
          <div class="rate-bar" style="margin-top:6px;"><div class="rate-bar-fill ${rateClass}" style="width:${pct}%;"></div></div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table-clean">
          <thead><tr><th>Date</th><th>Subject</th><th>Status</th><th>Time</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch {
    document.getElementById('drawer-body').innerHTML = `<div class="empty-state"><div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load history.</div></div>`;
  }
}

function closeStudentDrawer() {
  document.getElementById('student-drawer-overlay').classList.remove('open');
}

/* ══════════════════════════════
   SESSION HISTORY PANEL
══════════════════════════════ */
async function loadSessionHistory() {
  const wrap = document.getElementById('history-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  try {
    const sessions = await API.get('/teacher/sessions');

    if (!sessions.length) {
      wrap.innerHTML = `<div class="empty-state">
        <i class="fa-solid fa-calendar-days"></i>
        <div class="empty-state__title">No Sessions Yet</div>
        <div class="empty-state__text">Sessions you run will appear here.</div>
      </div>`;
      return;
    }

    const rows = sessions.map(s => {
      const date   = new Date(s.created_at).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
      const status = s.finalized
        ? `<span class="badge badge-finalized"><i class="fa-solid fa-lock"></i> Finalized</span>`
        : `<span class="badge badge-active"><span class="pulse-dot"></span> Open</span>`;
      return `<tr>
        <td style="font-family:var(--font-mono);font-size:13px;">${date}</td>
        <td><strong>${escapeHtml(s.subject_code)}</strong></td>
        <td style="font-size:13px;color:var(--text-muted);">${escapeHtml(s.subject_name)}</td>
        <td style="font-size:13px;">${escapeHtml(s.section_name)}</td>
        <td>${status}</td>
        <td>
          <span class="badge badge-present" style="margin-right:3px;">${s.present_count}P</span>
          <span class="badge badge-absent"  style="margin-right:3px;">${s.absent_count}A</span>
          <span class="badge badge-pending">${s.pending_count}?</span>
        </td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="viewHistoryRoster(${s.id}, '${escapeHtml(s.subject_code)} ${escapeHtml(s.section_name)}')">
            <i class="fa-solid fa-clipboard-list"></i>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="exportSessionCSV(${s.id})" title="Export CSV">
            <i class="fa-solid fa-file-arrow-down"></i>
          </button>
        </td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="table-clean">
        <thead><tr>
          <th>Date</th><th>Code</th><th>Subject</th><th>Section</th><th>Status</th><th>Stats</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load session history.</div></div>`;
  }
}

async function viewHistoryRoster(sessionId, title) {
  const section = document.getElementById('history-roster-section');
  const wrap    = document.getElementById('history-roster-wrap');
  document.getElementById('history-roster-title').textContent = `Roster — ${title}`;
  section.classList.remove('hidden');
  wrap.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  try {
    const { roster } = await API.get(`/teacher/roster/${sessionId}`);
    if (!roster.length) { wrap.innerHTML = '<p class="table-empty">No records.</p>'; return; }

    const rows = roster.map(r => {
      const cls  = { PRESENT:'badge-present', ABSENT:'badge-absent', PENDING:'badge-pending' }[r.status] || 'badge-pending';
      const icon = { PRESENT:'fa-circle-check', ABSENT:'fa-circle-xmark', PENDING:'fa-circle-minus' }[r.status] || 'fa-circle-minus';
      const time = r.timestamp ? new Date(r.timestamp).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' }) : '—';
      return `<tr>
        <td class="student-name">${escapeHtml(r.name)}</td>
        <td class="student-email" style="font-size:13px;">${escapeHtml(r.email || '')}</td>
        <td><span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${r.status}</span>
            ${r.is_manual ? '<span style="font-size:11px;color:var(--text-muted);margin-left:4px;">(manual)</span>' : ''}</td>
        <td style="font-size:13px;font-family:var(--font-mono);">${time}</td>
        <td style="font-size:13px;color:var(--text-muted);">${r.reason ? escapeHtml(r.reason) : '—'}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="table-clean">
        <thead><tr><th>Student</th><th>Email</th><th>Status</th><th>Time</th><th>Reason</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    section.scrollIntoView({ behavior: 'smooth' });
  } catch {
    wrap.innerHTML = '<p class="table-empty" style="color:var(--status-absent-text);">Failed to load roster.</p>';
  }
}

function exportSessionCSV(sessionId) {
  window.location.href = `/api/admin/export/${sessionId}`;
}

/* ══════════════════════════════
   SOCKET HANDLERS
══════════════════════════════ */
function onAttendanceUpdate(data) {
  const { sessionId, studentId, status, timestamp, is_manual } = data;
  if (parseInt(sessionId) !== activeSessionId) return;

  const row  = document.querySelector(`tr[data-student-id="${studentId}"]`);
  if (!row) return;

  const badge  = row.querySelector('.student-status-badge');
  const timeEl = row.querySelector('.student-timestamp');
  if (badge) {
    const cls  = { PRESENT:'badge-present', ABSENT:'badge-absent', PENDING:'badge-pending' }[status] || 'badge-pending';
    const icon = { PRESENT:'fa-circle-check', ABSENT:'fa-circle-xmark', PENDING:'fa-circle-minus' }[status] || 'fa-circle-minus';
    badge.className = `badge ${cls} student-status-badge`;
    badge.innerHTML = `<i class="fa-solid ${icon}"></i> ${status}`;
    if (is_manual && !row.querySelector('.manual-tag')) {
      row.querySelector('.student-name')?.insertAdjacentHTML('beforeend',
        ' <span class="manual-tag" style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">(manual)</span>');
    }
  }
  if (timeEl && timestamp) {
    timeEl.textContent = new Date(timestamp).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' });
  }

  // Update summary badge counts in header
  const allRows = document.querySelectorAll('#roster-container tbody tr');
  let present = 0, absent = 0, pending = 0;
  allRows.forEach(r => {
    const b = r.querySelector('.student-status-badge');
    if (!b) return;
    const txt = b.textContent.trim();
    if (txt.includes('PRESENT')) present++;
    else if (txt.includes('ABSENT')) absent++;
    else pending++;
  });
  document.querySelectorAll('.session-panel-header .badge').forEach(b => {
    if (b.textContent.includes('Present')) b.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${present} Present`;
    else if (b.textContent.includes('Absent')) b.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${absent} Absent`;
    else if (b.textContent.includes('Pending')) b.innerHTML = `<i class="fa-solid fa-circle-minus"></i> ${pending} Pending`;
  });
}

function onSessionFinalized(data) {
  if (data.sectionId === activeSectionId || data.sessionId === activeSessionId) {
    toast('Session has been finalized.', 'info');
    clearInterval(countdownInterval);
    if (activeSessionId) viewSession(activeSessionId, activeSectionId, '', '');
    loadTodaySubjects();
  }
}

function onSessionExpired(data) {
  if (data.sectionId === activeSectionId) {
    toast('Session window expired. Pending students marked absent.', 'warning');
  }
}

/* ══════════════════════════════
   OVERRIDE MODAL
══════════════════════════════ */
function openOverrideModal(sessionId, studentId, studentName) {
  document.getElementById('override-session-id').value     = sessionId;
  document.getElementById('override-student-id').value     = studentId;
  document.getElementById('override-student-name').textContent = studentName;
  document.getElementById('override-reason').value         = '';
  document.getElementById('override-error').hidden         = true;
  document.querySelectorAll('input[name="override-status"]').forEach(r => r.checked = false);
  document.getElementById('override-modal').classList.add('open');
}
function closeOverrideModal() {
  document.getElementById('override-modal').classList.remove('open');
}
async function submitOverride() {
  const sessionId = document.getElementById('override-session-id').value;
  const studentId = document.getElementById('override-student-id').value;
  const statusEl  = document.querySelector('input[name="override-status"]:checked');
  const reason    = document.getElementById('override-reason').value.trim();
  const errEl     = document.getElementById('override-error');
  errEl.hidden    = true;

  if (!statusEl) { errEl.textContent = 'Please select a status.'; errEl.hidden = false; return; }
  if (reason.length < 5) { errEl.textContent = 'Reason must be at least 5 characters.'; errEl.hidden = false; return; }

  const btn = document.getElementById('override-submit-btn');
  btn.disabled = true;

  try {
    await API.post('/attendance/override', {
      sessionId: parseInt(sessionId), studentId: parseInt(studentId),
      status: statusEl.value, reason
    });
    closeOverrideModal();
    toast('Attendance overridden.', 'success');
  } catch (err) {
    errEl.textContent = err.data?.error || 'Override failed.';
    errEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════════════════
   FINALIZE MODAL
══════════════════════════════ */
let pendingFinalizeSessionId = null;
function openFinalizeModal(sessionId) {
  pendingFinalizeSessionId = sessionId;
  document.getElementById('finalize-modal').classList.add('open');
}
function closeFinalizeModal() {
  document.getElementById('finalize-modal').classList.remove('open');
  pendingFinalizeSessionId = null;
}
async function confirmFinalize() {
  if (!pendingFinalizeSessionId) return;
  const btn = document.getElementById('finalize-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finalizing…';

  try {
    await API.post('/attendance/finalize', { sessionId: pendingFinalizeSessionId });
    closeFinalizeModal();
    toast('Session finalized. All pending → absent.', 'success');
    clearInterval(countdownInterval);
    await loadTodaySubjects();
    if (activeSessionId) viewSession(activeSessionId, activeSectionId, '', '');
  } catch (err) {
    toast(err.data?.error || 'Finalization failed.', 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-lock"></i> Finalize Session';
  }
}

/* ── Sidebar ── */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

init();
