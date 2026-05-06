let currentUser        = null;
let enrolledSections   = [];
let activeBannerSession = null;
let bannerCountdownInterval = null;
let currentHistoryView = 'list';
let currentWeekOffset  = 0;

const CAL_ABBREVS = ['MON','TUE','WED','THU','FRI'];
const CAL_SHORT   = ['Mon','Tue','Wed','Thu','Fri'];

function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekStart(offsetWeeks = 0) {
  const today = new Date();
  const jsDay = today.getDay(); // 0=Sun..6=Sat
  const toMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(today);
  monday.setDate(today.getDate() + toMonday + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatWeekLabel(weekStart) {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 4);
  const fmt = d => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  return `${fmt(weekStart)} – ${fmt(end)}, ${end.getFullYear()}`;
}

function isScheduledOn(days, calIdx) { // calIdx 0=Mon..4=Fri
  return days.split(',').map(d => d.trim()).includes(CAL_ABBREVS[calIdx]);
}

function setHistoryView(view) {
  currentHistoryView = view;
  document.getElementById('view-list-btn')?.classList.toggle('active', view === 'list');
  document.getElementById('view-cal-btn')?.classList.toggle('active', view === 'calendar');
  document.getElementById('week-nav')?.classList.toggle('hidden', view !== 'calendar');
  loadHistory();
}

function changeWeek(delta) {
  currentWeekOffset += delta;
  document.getElementById('week-label').textContent = formatWeekLabel(getWeekStart(currentWeekOffset));
  loadHistory();
}

/* ── Toast bridge ── */
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

/* ── Helpers ── */
function getInitials(name) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase();
}
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
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

/* ═══════════════════════════
   INIT
═══════════════════════════ */
async function init() {
  currentUser = await checkAuth('STUDENT');
  if (!currentUser) return;

  document.getElementById('nav-user-name').textContent       = currentUser.name;
  document.getElementById('nav-user-name-header').textContent = currentUser.name;
  document.getElementById('nav-avatar').textContent          = getInitials(currentUser.name);

  /* Notification permission prompt */
  if ('Notification' in window && Notification.permission === 'default') {
    const prompt = document.getElementById('notif-prompt');
    if (prompt) prompt.classList.remove('hidden');
  }

  const socket = initSocket();
  socket.on('attendance_started', onAttendanceStarted);
  socket.on('session_finalized',  onSessionFinalized);
  socket.on('session_expired',    onSessionExpired);
  socket.on('attendance_update',  onAttendanceUpdate);

  await loadSections();

  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
  });
  document.getElementById('sidebar-overlay').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  });

  document.getElementById('join-code-input').addEventListener('input', function () {
    this.value = this.value.toUpperCase();
  });
}

/* ── Notification helpers ── */
function requestNotifPermission() {
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      toast('Notifications enabled!', 'success');
      document.getElementById('notif-prompt')?.classList.add('hidden');
    }
  });
}
function dismissNotifPrompt() {
  document.getElementById('notif-prompt')?.classList.add('hidden');
  localStorage.setItem('notif-prompt-dismissed', '1');
}

/* ── Panel switching ── */
function showPanel(name) {
  ['sections', 'history'].forEach(p => {
    document.getElementById(`panel-${p}`)?.classList.toggle('hidden', p !== name);
  });
  document.querySelectorAll('.sidebar-link[id^="nav-"]').forEach(l => l.classList.remove('active'));
  document.getElementById(`nav-${name}`)?.classList.add('active');

  if (name === 'history') loadHistory();
}

/* ═══════════════════════════
   SECTIONS
═══════════════════════════ */
async function loadSections() {
  const grid = document.getElementById('sections-grid');
  grid.innerHTML = '<div class="loading-center" style="grid-column:1/-1;"><div class="spinner"></div></div>';

  try {
    const data = await API.get('/student/sections');
    enrolledSections = data;

    if (!data.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <i class="fa-solid fa-layer-group"></i>
          <div class="empty-state__title">No Sections Enrolled</div>
          <div class="empty-state__text">Use the join code from your professor to enroll in a section.</div>
        </div>`;
      renderStudentStats([], {}, {});
      return;
    }

    /* Join socket rooms */
    data.forEach(sec => joinSection(sec.id));

    /* Check active sessions for all sections */
    const sessionChecks = await Promise.allSettled(
      data.map(sec => API.get(`/attendance/active/${sec.id}`))
    );
    const activeSessions = {};
    sessionChecks.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value.session)
        activeSessions[data[i].id] = result.value.session;
    });

    /* Check student's own record for each active session */
    const recordChecks = await Promise.allSettled(
      Object.entries(activeSessions).map(([sectionId, sess]) =>
        API.get(`/attendance/session/${sess.id}`)
          .then(r => ({ sectionId: parseInt(sectionId), record: r.studentRecord }))
      )
    );
    const myRecords = {};
    recordChecks.forEach(r => {
      if (r.status === 'fulfilled') myRecords[r.value.sectionId] = r.value.record;
    });

    /* Render stats from history */
    loadStudentStatsQuick();

    grid.innerHTML = data.map(sec =>
      buildSectionCard(sec, activeSessions[sec.id] || null, myRecords[sec.id] || null)
    ).join('');

    /* Populate history filter */
    populateHistoryFilter(data);

  } catch {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load sections.</div>
    </div>`;
  }
}

async function loadStudentStatsQuick() {
  try {
    const records = await API.get(`/attendance/history/${currentUser.id}`);
    const total   = records.length;
    const present = records.filter(r => r.status === 'PRESENT').length;
    const absent  = records.filter(r => r.status === 'ABSENT').length;
    const pct     = total > 0 ? Math.round((present / total) * 100) : 0;
    const rateClass = pct >= 75 ? 'high' : pct >= 50 ? 'medium' : 'low';

    document.getElementById('student-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-icon blue"><i class="fa-solid fa-calendar-days"></i></div>
        <div class="stat-label">Total Sessions</div>
        <div class="stat-value" style="font-family:var(--font-display);">${total}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><i class="fa-solid fa-circle-check"></i></div>
        <div class="stat-label">Present</div>
        <div class="stat-value" style="font-family:var(--font-display);color:var(--status-present-text);">${present}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red"><i class="fa-solid fa-circle-xmark"></i></div>
        <div class="stat-label">Absent</div>
        <div class="stat-value" style="font-family:var(--font-display);color:var(--status-absent-text);">${absent}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon ${pct >= 75 ? 'green' : 'red'}"><i class="fa-solid fa-percent"></i></div>
        <div class="stat-label">Attendance Rate</div>
        <div class="stat-value" style="font-family:var(--font-display);">${pct}%</div>
        <div class="rate-bar" style="margin-top:8px;">
          <div class="rate-bar-fill ${rateClass}" style="width:${pct}%;"></div>
        </div>
      </div>`;
  } catch { /* stats are non-critical */ }
}

function buildSectionCard(sec, activeSession, myRecord) {
  /* Button + status logic */
  let btnHtml = '', statusBadge = '';

  if (!activeSession) {
    btnHtml = `<button class="btn btn-secondary btn-block" disabled>
      <i class="fa-solid fa-lock" style="opacity:.5;"></i> No Active Session
    </button>`;
  } else if (activeSession.finalized === 1) {
    const status = myRecord?.status || 'ABSENT';
    const cls    = { PRESENT:'badge-present', ABSENT:'badge-absent', PENDING:'badge-pending' }[status] || 'badge-pending';
    const icon   = { PRESENT:'fa-circle-check', ABSENT:'fa-circle-xmark', PENDING:'fa-circle-minus' }[status] || 'fa-circle-minus';
    statusBadge  = `<span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${status}</span>`;
    btnHtml = `<button class="btn btn-secondary btn-block" disabled>
      <i class="fa-solid fa-lock"></i> Session Closed
    </button>`;
  } else {
    const expiryMs = new Date(activeSession.expires_at).getTime();
    if (expiryMs < Date.now()) {
      statusBadge = `<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> Expired</span>`;
      btnHtml = `<button class="btn btn-secondary btn-block" disabled>
        <i class="fa-solid fa-clock"></i> Session Expired
      </button>`;
    } else if (myRecord && myRecord.status === 'PRESENT') {
      const markedAt = myRecord.timestamp
        ? new Date(myRecord.timestamp).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' })
        : '';
      statusBadge = `<span class="badge badge-present"><i class="fa-solid fa-circle-check"></i> Present</span>`;
      btnHtml = `<button class="btn btn-secondary btn-block" disabled>
        <i class="fa-solid fa-circle-check" style="color:var(--status-present-text);"></i>
        Marked Present${markedAt ? ` · ${markedAt}` : ''}
      </button>`;
    } else {
      statusBadge = `<span class="badge badge-active"><span class="pulse-dot"></span> Session Open</span>`;
      btnHtml = `<button class="btn btn-primary btn-block" id="mark-btn-${sec.id}"
        onclick="markPresent(${activeSession.id}, ${sec.id})">
        <i class="fa-solid fa-circle-check"></i> Mark Present
      </button>`;
    }
  }

  /* Join code — hidden by default, reveal on eye click */
  const joinCodeHtml = `
    <div class="section-card__join-code">
      <i class="fa-solid fa-key" style="color:var(--text-muted);font-size:12px;"></i>
      <span class="code-hidden" id="code-dots-${sec.id}">••••••</span>
      <span class="code-reveal" id="code-val-${sec.id}">${escapeHtml(sec.join_code || '')}</span>
      <button class="code-eye" onclick="toggleJoinCode(${sec.id})" id="code-eye-${sec.id}" title="Reveal join code">
        <i class="fa-solid fa-eye"></i>
      </button>
    </div>`;

  return `
    <div class="section-card" id="section-card-${sec.id}">
      <div class="section-card__subject-code">${escapeHtml(sec.subject_code)}</div>
      <div class="section-card__subject-name">${escapeHtml(sec.subject_name)}</div>
      <div class="section-card__meta">
        <i class="fa-solid fa-clock" style="opacity:.6;margin-right:3px;"></i>${formatTime(sec.time_start)} – ${formatTime(sec.time_end)}
        &nbsp;&bull;&nbsp;
        <i class="fa-solid fa-calendar-days" style="opacity:.6;margin-right:3px;"></i>${formatDays(sec.days)}
      </div>
      <div class="section-card__professor">
        <i class="fa-solid fa-chalkboard-user"></i> ${escapeHtml(sec.professor_name)}
        &nbsp;·&nbsp; ${escapeHtml(sec.section_name)}
      </div>
      ${joinCodeHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
        <span></span>${statusBadge}
      </div>
      <div class="section-card__actions" style="margin-top:8px;">${btnHtml}</div>
    </div>`;
}

function toggleJoinCode(sectionId) {
  const dots  = document.getElementById(`code-dots-${sectionId}`);
  const val   = document.getElementById(`code-val-${sectionId}`);
  const eye   = document.getElementById(`code-eye-${sectionId}`);
  const shown = val.classList.contains('show');

  dots.style.display = shown ? '' : 'none';
  val.classList.toggle('show', !shown);
  eye.innerHTML = shown
    ? '<i class="fa-solid fa-eye"></i>'
    : '<i class="fa-solid fa-eye-slash"></i>';
}

function populateHistoryFilter(sections) {
  const sel = document.getElementById('history-subject-filter');
  if (!sel) return;
  sel.innerHTML = '<option value="">All Subjects</option>';
  const seen = new Set();
  sections.forEach(s => {
    if (!seen.has(s.subject_code)) {
      seen.add(s.subject_code);
      const opt = document.createElement('option');
      opt.value = s.subject_code;
      opt.textContent = `${s.subject_code} — ${s.subject_name}`;
      sel.appendChild(opt);
    }
  });
}

/* ── Mark present ── */
async function markPresent(sessionId, sectionId) {
  const btn = document.getElementById(`mark-btn-${sectionId}`) ||
              document.getElementById('banner-mark-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Marking…';
  }

  try {
    await API.post('/attendance/mark', { sessionId });
    toast('Attendance marked! You are present.', 'success');
    hideBanner();
    await loadSections();
  } catch (err) {
    toast(err.data?.error || 'Failed to mark attendance.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Mark Present';
    }
  }
}

/* ── Join section ── */
async function joinSection_() {
  const code  = document.getElementById('join-code-input').value.trim().toUpperCase();
  const errEl = document.getElementById('join-error');
  errEl.hidden = true;

  if (code.length !== 6) {
    errEl.textContent = 'Join code must be exactly 6 characters.';
    errEl.hidden = false;
    return;
  }

  try {
    await API.post('/student/join', { joinCode: code });
    toast('Successfully enrolled in section!', 'success');
    document.getElementById('join-code-input').value = '';
    await loadSections();
  } catch (err) {
    errEl.textContent = err.data?.error || 'Invalid or unknown join code.';
    errEl.hidden = false;
  }
}

/* ═══════════════════════════
   ATTENDANCE HISTORY
═══════════════════════════ */
async function loadHistory() {
  if (currentHistoryView === 'calendar') {
    await loadCalendarHistory();
  } else {
    await loadListHistory();
  }
}

async function loadListHistory() {
  const content = document.getElementById('history-content');
  content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  const subjectFilter = document.getElementById('history-subject-filter')?.value || '';

  try {
    const records = await API.get(`/attendance/history/${currentUser.id}`);
    const filtered = subjectFilter ? records.filter(r => r.subject_code === subjectFilter) : records;

    if (!filtered.length) {
      content.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <div class="empty-state__title">No Attendance Records</div>
          <div class="empty-state__text">Your attendance history will appear here once sessions are recorded.</div>
        </div>`;
      return;
    }

    /* Group by subject + section */
    const bySubject = {};
    filtered.forEach(r => {
      const key = `${r.subject_code}|${r.section_name}`;
      if (!bySubject[key]) bySubject[key] = { code: r.subject_code, name: r.subject_name, section: r.section_name, records: [] };
      bySubject[key].records.push(r);
    });

    let html = '';
    for (const subj of Object.values(bySubject)) {
      const total   = subj.records.length;
      const present = subj.records.filter(r => r.status === 'PRESENT').length;
      const absent  = subj.records.filter(r => r.status === 'ABSENT').length;
      const pct     = total > 0 ? Math.round((present / total) * 100) : 0;
      const rateClass = pct >= 75 ? 'high' : pct >= 50 ? 'medium' : 'low';

      const rows = subj.records.map(r => {
        const date = new Date(r.session_date).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
        const time = r.timestamp ? new Date(r.timestamp).toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' }) : '—';
        const cls  = { PRESENT:'badge-present', ABSENT:'badge-absent', PENDING:'badge-pending' }[r.status] || 'badge-pending';
        const icon = { PRESENT:'fa-circle-check', ABSENT:'fa-circle-xmark', PENDING:'fa-circle-minus' }[r.status] || 'fa-circle-minus';
        const manualNote = r.is_manual && r.reason
          ? `<br><small style="color:var(--text-muted);">${escapeHtml(r.reason)}</small>`
          : '';
        return `<tr>
          <td style="font-family:var(--font-mono);font-size:13px;">${date}</td>
          <td>
            <span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${r.status}</span>
            ${manualNote}
          </td>
          <td style="font-family:var(--font-mono);font-size:13px;color:var(--text-muted);">${time}</td>
        </tr>`;
      }).join('');

      html += `
        <div class="history-section">
          <h4>
            <span style="font-family:var(--font-mono);font-size:13px;color:var(--accent);">${escapeHtml(subj.code)}</span>
            — ${escapeHtml(subj.name)}
            <span style="font-size:12px;font-weight:400;color:var(--text-muted);">(${escapeHtml(subj.section)})</span>
          </h4>
          <div class="grid-stats" style="grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
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
              <thead><tr><th>Date</th><th>Status</th><th>Time Marked</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }
    content.innerHTML = html;
  } catch {
    content.innerHTML = `<div class="empty-state">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load history.</div>
    </div>`;
  }
}

async function loadCalendarHistory() {
  const content = document.getElementById('history-content');
  content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  const weekStart = getWeekStart(currentWeekOffset);
  const weekEnd   = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const weekLabel = document.getElementById('week-label');
  if (weekLabel) weekLabel.textContent = formatWeekLabel(weekStart);

  const subjectFilter = document.getElementById('history-subject-filter')?.value || '';

  try {
    const [records, subjects] = await Promise.all([
      API.get(`/attendance/history/${currentUser.id}?from=${localISODate(weekStart)}&to=${localISODate(weekEnd)}`),
      API.get('/student/subjects')
    ]);

    const filteredSubjects = subjectFilter ? subjects.filter(s => s.code === subjectFilter) : subjects;
    content.innerHTML = renderCalendarTable(records, filteredSubjects, weekStart);
  } catch {
    content.innerHTML = `<div class="empty-state">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <div class="empty-state__text" style="color:var(--status-absent-text)">Failed to load calendar.</div>
    </div>`;
  }
}

function renderCalendarTable(records, subjects, weekStart) {
  if (!subjects.length) {
    return `<div class="empty-state">
      <i class="fa-solid fa-calendar-week"></i>
      <div class="empty-state__title">No Subjects</div>
      <div class="empty-state__text">Enroll in sections to see your attendance calendar.</div>
    </div>`;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  /* Build lookup: "YYYY-MM-DD_subjectId" → record */
  const lookup = {};
  records.forEach(r => {
    const dateStr = localISODate(new Date(r.session_date));
    lookup[`${dateStr}_${r.subject_id}`] = r;
  });

  /* Header columns */
  const headerCols = subjects.map(s => `
    <th>
      <div style="font-family:var(--font-mono);font-size:11px;letter-spacing:.04em;">${escapeHtml(s.code)}</div>
      <div style="font-size:10px;color:var(--text-muted);font-weight:400;margin-top:2px;">${formatTime(s.time_start)}</div>
    </th>`).join('');

  /* Mon–Fri rows */
  const rows = Array.from({ length: 5 }, (_, i) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    const isToday  = day.getTime() === todayStart.getTime();
    const isoDate  = localISODate(day);
    const shortDate = day.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });

    const cells = subjects.map(s => {
      if (!isScheduledOn(s.days, i)) {
        return `<td style="background:var(--bg-base);"><span class="cal-badge na" title="Not scheduled this day">—</span></td>`;
      }
      const rec = lookup[`${isoDate}_${s.id}`];
      if (!rec) {
        return `<td><span class="cal-badge no-session" title="No session held"><i class="fa-regular fa-circle"></i></span></td>`;
      }
      const badgeCls = { PRESENT:'present', ABSENT:'absent', PENDING:'pending' }[rec.status] || 'pending';
      const icon     = { PRESENT:'fa-check', ABSENT:'fa-xmark', PENDING:'fa-minus' }[rec.status] || 'fa-minus';
      const tip      = rec.status + (rec.is_manual ? ' (manual override)' : '');
      return `<td><span class="cal-badge ${badgeCls}" title="${tip}"><i class="fa-solid ${icon}"></i></span></td>`;
    }).join('');

    return `<tr class="cal-row${isToday ? ' today' : ''}">
      <td class="cal-day-cell">
        <div class="cal-day-abbr">${CAL_SHORT[i]}</div>
        <div class="cal-day-date">${shortDate}</div>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  return `
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:14px;">
      <div style="overflow-x:auto;">
        <table class="calendar-table">
          <thead><tr>
            <th class="cal-day-cell" style="text-align:left;">Day</th>
            ${headerCols}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="calendar-legend">
      <span class="legend-item"><span class="cal-badge present" style="width:20px;height:20px;font-size:10px;"><i class="fa-solid fa-check"></i></span> Present</span>
      <span class="legend-item"><span class="cal-badge absent" style="width:20px;height:20px;font-size:10px;"><i class="fa-solid fa-xmark"></i></span> Absent</span>
      <span class="legend-item"><span class="cal-badge pending" style="width:20px;height:20px;font-size:10px;"><i class="fa-solid fa-minus"></i></span> Pending</span>
      <span class="legend-item"><span class="cal-badge no-session" style="width:20px;height:20px;font-size:10px;"><i class="fa-regular fa-circle"></i></span> No Session</span>
      <span class="legend-item"><span class="cal-badge na" style="width:20px;height:20px;font-size:14px;">—</span> Not Scheduled</span>
    </div>`;
}

/* ═══════════════════════════
   BANNER
═══════════════════════════ */
function onAttendanceStarted(data) {
  const sec = enrolledSections.find(s => s.id === data.sectionId);
  if (!sec) return;

  activeBannerSession = data;

  const banner  = document.getElementById('attendance-banner');
  const titleEl = document.getElementById('banner-title');
  const subEl   = document.getElementById('banner-sub');
  const markBtn = document.getElementById('banner-mark-btn');

  titleEl.textContent = `Attendance open: ${sec.subject_code} – ${sec.subject_name}`;
  subEl.textContent   = 'Mark your attendance before the session closes!';
  markBtn.onclick     = () => markPresent(data.sessionId, data.sectionId);
  markBtn.disabled    = false;
  markBtn.innerHTML   = '<i class="fa-solid fa-circle-check"></i> Mark Present';

  banner.classList.remove('hidden');
  startBannerCountdown(data.expiresAt);

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('ClareTrack Pro — Attendance Open', {
      body: `Mark your attendance for ${sec.subject_code}. Session closes soon.`,
      icon: '/favicon.ico'
    });
  }

  loadSections();
}

function startBannerCountdown(expiresAt) {
  clearInterval(bannerCountdownInterval);
  bannerCountdownInterval = setInterval(() => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    const subEl = document.getElementById('banner-sub');
    if (!subEl) { clearInterval(bannerCountdownInterval); return; }
    if (remaining <= 0) {
      clearInterval(bannerCountdownInterval);
      subEl.textContent = 'Session has expired.';
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    subEl.textContent = `Time remaining: ${mins}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

function hideBanner() {
  clearInterval(bannerCountdownInterval);
  document.getElementById('attendance-banner')?.classList.add('hidden');
  activeBannerSession = null;
}

/* ═══════════════════════════
   SOCKET HANDLERS
═══════════════════════════ */
function onSessionFinalized(data) {
  const sec = enrolledSections.find(s => s.id === data.sectionId);
  if (!sec) return;
  toast(`Session for ${sec.subject_code} has been finalized.`, 'info');
  if (activeBannerSession?.sectionId === data.sectionId) hideBanner();
  loadSections();
}

function onSessionExpired(data) {
  const sec = enrolledSections.find(s => s.id === data.sectionId);
  if (!sec) return;
  if (activeBannerSession?.sectionId === data.sectionId) hideBanner();
  loadSections();
}

function onAttendanceUpdate(data) {
  if (data.studentId !== currentUser.id) return;
  loadSections();
}

init();
