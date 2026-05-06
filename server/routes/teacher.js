const express = require('express');
const { DateTime } = require('luxon');
const XLSX = require('xlsx');
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

function csvEscape(str) {
  if (str == null) return '""';
  return `"${String(str).replace(/"/g, '""')}"`;
}

const router = express.Router();

const DAY_MAP = { 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT', 7: 'SUN' };

// GET /api/teacher/subjects — today's subjects for the logged-in professor
router.get('/subjects', requireAuth, requireRole('TEACHER'), (req, res) => {
  const now = DateTime.now().setZone('Asia/Manila');
  const todayAbbrev = DAY_MAP[now.weekday];

  const subjects = db.prepare(`
    SELECT s.id, s.code, s.name, s.time_start, s.time_end, s.days, s.teacher_id
    FROM subjects s
    WHERE s.teacher_id = ?
  `).all(req.session.userId);

  const todaySubjects = subjects.filter(s =>
    s.days.split(',').map(d => d.trim()).includes(todayAbbrev)
  );

  // For each subject, fetch its sections and active session info
  const startUTC = now.startOf('day').toUTC().toISO();
  const endUTC = now.endOf('day').toUTC().toISO();

  const result = todaySubjects.map(subject => {
    const sections = db.prepare(`
      SELECT sec.id, sec.name, sec.join_code
      FROM sections sec
      WHERE sec.subject_id = ?
    `).all(subject.id);

    const sectionsWithSession = sections.map(section => {
      const session = db.prepare(`
        SELECT id, created_at, expires_at, finalized
        FROM attendance_sessions
        WHERE section_id = ? AND created_at >= ? AND created_at < ?
        ORDER BY created_at DESC LIMIT 1
      `).get(section.id, startUTC, endUTC);

      return { ...section, session: session || null };
    });

    return { ...subject, sections: sectionsWithSession };
  });

  res.json(result);
});

// GET /api/teacher/subjects/all — all subjects with sections and enrollment counts
router.get('/subjects/all', requireAuth, requireRole('TEACHER'), (req, res) => {
  const subjects = db.prepare(`
    SELECT s.id, s.code, s.name, s.time_start, s.time_end, s.days
    FROM subjects s
    WHERE s.teacher_id = ?
    ORDER BY s.code
  `).all(req.session.userId);

  const result = subjects.map(subject => {
    const sections = db.prepare(`
      SELECT sec.id, sec.name, sec.join_code,
        (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = sec.id) AS enrolled_count
      FROM sections sec
      WHERE sec.subject_id = ?
    `).all(subject.id);
    return { ...subject, sections };
  });

  res.json(result);
});

// GET /api/teacher/sections/:subjectId — sections for a subject owned by this professor
router.get('/sections/:subjectId', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { subjectId } = req.params;

  const subject = db.prepare(
    'SELECT id FROM subjects WHERE id = ? AND teacher_id = ?'
  ).get(subjectId, req.session.userId);

  if (!subject) return res.status(404).json({ error: 'Subject not found' });

  const sections = db.prepare(`
    SELECT id, name, join_code FROM sections WHERE subject_id = ?
  `).all(subjectId);

  res.json(sections);
});

// GET /api/teacher/roster/:sessionId — enrolled students + attendance status
router.get('/roster/:sessionId', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { sessionId } = req.params;

  // Verify teacher owns this session
  const session = db.prepare(`
    SELECT asn.id, asn.section_id, asn.expires_at, asn.finalized, asn.created_at
    FROM attendance_sessions asn
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE asn.id = ? AND sub.teacher_id = ?
  `).get(sessionId, req.session.userId);

  if (!session) return res.status(404).json({ error: 'Session not found' });

  const roster = db.prepare(`
    SELECT
      u.id, u.name, u.email,
      ar.status, ar.is_manual, ar.reason, ar.timestamp
    FROM enrollments e
    JOIN users u ON u.id = e.student_id
    LEFT JOIN attendance_records ar ON ar.session_id = ? AND ar.student_id = u.id
    WHERE e.section_id = ?
    ORDER BY u.name ASC
  `).all(sessionId, session.section_id);

  res.json({ session, roster });
});

// GET /api/teacher/sessions — all sessions run by this professor (for history panel)
router.get('/sessions', requireAuth, requireRole('TEACHER'), (req, res) => {
  const sessions = db.prepare(`
    SELECT
      asn.id, asn.created_at, asn.expires_at, asn.finalized,
      sub.code  AS subject_code,
      sub.name  AS subject_name,
      sec.name  AS section_name,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = asn.id AND ar.status = 'PRESENT') AS present_count,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = asn.id AND ar.status = 'ABSENT')  AS absent_count,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = asn.id AND ar.status = 'PENDING') AS pending_count
    FROM attendance_sessions asn
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE sub.teacher_id = ?
    ORDER BY asn.created_at DESC
  `).all(req.session.userId);
  res.json(sessions);
});

// GET /api/teacher/students — enrolled students across teacher's sections with attendance stats
router.get('/students', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { subjectId, sectionId } = req.query;

  let whereClause = 'sub.teacher_id = ?';
  const params = [req.session.userId];

  if (subjectId) { whereClause += ' AND sub.id = ?'; params.push(subjectId); }
  if (sectionId) { whereClause += ' AND sec.id = ?'; params.push(sectionId); }

  const students = db.prepare(`
    SELECT DISTINCT
      u.id, u.name, u.email,
      sec.name  AS section_name,
      sub.code  AS subject_code,
      (SELECT COUNT(DISTINCT asn.id)
         FROM attendance_sessions asn
         WHERE asn.section_id = e.section_id) AS total_sessions,
      (SELECT COUNT(*)
         FROM attendance_records ar2
         JOIN attendance_sessions asn2 ON asn2.id = ar2.session_id
         WHERE ar2.student_id = u.id AND ar2.status = 'PRESENT'
           AND asn2.section_id = e.section_id) AS present_count,
      (SELECT MAX(ar3.timestamp)
         FROM attendance_records ar3
         JOIN attendance_sessions asn3 ON asn3.id = ar3.session_id
         WHERE ar3.student_id = u.id AND ar3.status = 'PRESENT'
           AND asn3.section_id = e.section_id) AS last_seen
    FROM enrollments e
    JOIN users u ON u.id = e.student_id
    JOIN sections sec ON sec.id = e.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE ${whereClause}
    ORDER BY u.name ASC
  `).all(...params);

  res.json(students);
});

// GET /api/teacher/student/:studentId/history — per-student attendance records visible to this teacher
router.get('/student/:studentId/history', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { studentId } = req.params;

  const records = db.prepare(`
    SELECT
      ar.status, ar.is_manual, ar.reason, ar.timestamp,
      asn.created_at AS session_date,
      sub.code  AS subject_code,
      sub.name  AS subject_name,
      sec.name  AS section_name
    FROM attendance_records ar
    JOIN attendance_sessions asn ON asn.id = ar.session_id
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE ar.student_id = ? AND sub.teacher_id = ?
    ORDER BY asn.created_at DESC
  `).all(studentId, req.session.userId);

  res.json(records);
});

// GET /api/teacher/join-requests — pending join requests for this teacher's sections
router.get('/join-requests', requireAuth, requireRole('TEACHER'), (req, res) => {
  const requests = db.prepare(`
    SELECT jr.id, jr.status, jr.created_at,
           u.id AS student_id, u.name AS student_name, u.email AS student_email,
           sec.id AS section_id, sec.name AS section_name,
           sub.code AS subject_code, sub.name AS subject_name
    FROM join_requests jr
    JOIN users u ON u.id = jr.student_id
    JOIN sections sec ON sec.id = jr.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE sub.teacher_id = ? AND jr.status = 'PENDING'
    ORDER BY jr.created_at ASC
  `).all(req.session.userId);
  res.json(requests);
});

// POST /api/teacher/join-requests/:id/accept
router.post('/join-requests/:id/accept', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { id } = req.params;
  const request = db.prepare(`
    SELECT jr.*, sub.teacher_id
    FROM join_requests jr
    JOIN sections sec ON sec.id = jr.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE jr.id = ? AND jr.status = 'PENDING' AND sub.teacher_id = ?
  `).get(id, req.session.userId);

  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.transaction(() => {
    db.prepare("UPDATE join_requests SET status='ACCEPTED', responded_at=datetime('now'), responded_by=? WHERE id=?")
      .run(req.session.userId, id);
    db.prepare('INSERT OR IGNORE INTO enrollments (student_id, section_id) VALUES (?, ?)')
      .run(request.student_id, request.section_id);
  })();

  const io = req.app.get('io');
  const section = db.prepare('SELECT name, subject_id FROM sections WHERE id = ?').get(request.section_id);
  const subject = db.prepare('SELECT code, name FROM subjects WHERE id = ?').get(section.subject_id);
  io.to(`user_${request.student_id}`).emit('join_response', {
    accepted:    true,
    sectionId:   request.section_id,
    sectionName: section.name,
    subjectCode: subject.code,
    subjectName: subject.name
  });

  res.json({ success: true });
});

// POST /api/teacher/join-requests/:id/reject
router.post('/join-requests/:id/reject', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const request = db.prepare(`
    SELECT jr.*, sub.teacher_id
    FROM join_requests jr
    JOIN sections sec ON sec.id = jr.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE jr.id = ? AND jr.status = 'PENDING' AND sub.teacher_id = ?
  `).get(id, req.session.userId);

  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.prepare("UPDATE join_requests SET status='REJECTED', responded_at=datetime('now'), responded_by=? WHERE id=?")
    .run(req.session.userId, id);

  const io = req.app.get('io');
  const section = db.prepare('SELECT name, subject_id FROM sections WHERE id = ?').get(request.section_id);
  const subject = db.prepare('SELECT code, name FROM subjects WHERE id = ?').get(section.subject_id);
  io.to(`user_${request.student_id}`).emit('join_response', {
    accepted:    false,
    sectionId:   request.section_id,
    sectionName: section.name,
    subjectCode: subject.code,
    subjectName: subject.name,
    reason:      reason || ''
  });

  res.json({ success: true });
});

function getSessionExportData(sessionId, teacherId) {
  const session = db.prepare(`
    SELECT asn.id, asn.created_at, asn.expires_at, asn.finalized,
           sec.name  AS section_name,
           sub.code  AS subject_code, sub.name AS subject_name,
           sub.time_start, sub.time_end, sub.days,
           u.name    AS professor_name
    FROM attendance_sessions asn
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    JOIN users u ON u.id = sub.teacher_id
    WHERE asn.id = ? AND sub.teacher_id = ?
  `).get(sessionId, teacherId);

  if (!session) return null;

  const records = db.prepare(`
    SELECT u.name, u.email, ar.status, ar.is_manual, ar.reason, ar.timestamp
    FROM attendance_records ar
    JOIN users u ON u.id = ar.student_id
    WHERE ar.session_id = ?
    ORDER BY u.name ASC
  `).all(sessionId);

  return { session, records };
}

// GET /api/teacher/export/:sessionId — CSV
router.get('/export/:sessionId', requireAuth, requireRole('TEACHER'), (req, res) => {
  const data = getSessionExportData(req.params.sessionId, req.session.userId);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  const { session, records } = data;

  const lines = ['Subject Code,Subject Name,Professor,Section,Date,Time,Days,Student Name,Email,Status,Manual Override,Reason,Marked At'];
  records.forEach(r => {
    lines.push([
      csvEscape(session.subject_code),
      csvEscape(session.subject_name),
      csvEscape(session.professor_name),
      csvEscape(session.section_name),
      session.created_at.substring(0, 10),
      `${session.time_start} – ${session.time_end}`,
      session.days,
      csvEscape(r.name),
      csvEscape(r.email),
      r.status,
      r.is_manual ? 'Yes' : 'No',
      csvEscape(r.reason),
      r.timestamp || ''
    ].join(','));
  });

  const filename = `${session.subject_code}_${session.section_name}_${session.created_at.substring(0,10)}.csv`
    .replace(/[^a-zA-Z0-9_\-.]/g, '_');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\r\n'));
});

// GET /api/teacher/export/:sessionId/xlsx — Excel
router.get('/export/:sessionId/xlsx', requireAuth, requireRole('TEACHER'), (req, res) => {
  const data = getSessionExportData(req.params.sessionId, req.session.userId);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  const { session, records } = data;

  const rows = records.map(r => ({
    'Subject Code':    session.subject_code,
    'Subject Name':    session.subject_name,
    'Professor':       session.professor_name,
    'Section':         session.section_name,
    'Session Date':    session.created_at.substring(0, 10),
    'Schedule':        `${session.time_start} – ${session.time_end}`,
    'Days':            session.days,
    'Student Name':    r.name,
    'Email':           r.email,
    'Status':          r.status,
    'Manual Override': r.is_manual ? 'Yes' : 'No',
    'Reason':          r.reason || '',
    'Marked At':       r.timestamp || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Attendance');

  const filename = `${session.subject_code}_${session.section_name}_${session.created_at.substring(0,10)}.xlsx`
    .replace(/[^a-zA-Z0-9_\-.]/g, '_');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
});

module.exports = router;
