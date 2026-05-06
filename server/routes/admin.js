const express = require('express');
const bcrypt = require('bcryptjs');
const { DateTime } = require('luxon');
const XLSX = require('xlsx');
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('ADMIN')];

function csvEscape(str) {
  if (str == null) return '""';
  return `"${String(str).replace(/"/g, '""')}"`;
}

// ===== USERS =====

// GET /api/admin/users
router.get('/users', ...adminOnly, (req, res) => {
  const users = db.prepare(
    'SELECT id, name, email, role, created_at FROM users ORDER BY role, name'
  ).all();
  res.json(users);
});

// POST /api/admin/users — create TEACHER or ADMIN only
router.post('/users', ...adminOnly, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, and password are required' });
  if (!['TEACHER', 'ADMIN'].includes(role)) return res.status(400).json({ error: 'Admin can only create TEACHER or ADMIN accounts' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim());
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const hashed = await bcrypt.hash(password, 12);
  const result = db.prepare(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), email.trim().toLowerCase(), hashed, role);

  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(user);
});

// PUT /api/admin/users/:id
router.put('/users/:id', ...adminOnly, async (req, res) => {
  const { name, email, password, role } = req.body;
  const { id } = req.params;

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates = [];
  const params = [];

  if (name)  { updates.push('name = ?');  params.push(name.trim()); }
  if (email) { updates.push('email = ?'); params.push(email.trim().toLowerCase()); }
  if (role && ['ADMIN','TEACHER','STUDENT'].includes(role)) {
    updates.push('role = ?');
    params.push(role);
  }
  if (password) {
    const hashed = await bcrypt.hash(password, 12);
    updates.push('password = ?');
    params.push(hashed);
  }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  params.push(id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(id);
  res.json(updated);
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', ...adminOnly, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.session.userId) return res.status(400).json({ error: 'Cannot delete your own account' });
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true });
});

// ===== SUBJECTS =====

router.get('/subjects', ...adminOnly, (req, res) => {
  const subjects = db.prepare(`
    SELECT s.*, u.name as teacher_name
    FROM subjects s
    LEFT JOIN users u ON u.id = s.teacher_id
    ORDER BY s.code
  `).all();
  res.json(subjects);
});

router.post('/subjects', ...adminOnly, (req, res) => {
  const { code, name, time_start, time_end, days, teacher_id } = req.body;
  if (!code || !name || !time_start || !time_end || !days || !teacher_id) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const result = db.prepare(
    'INSERT INTO subjects (code, name, time_start, time_end, days, teacher_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(code.trim(), name.trim(), time_start, time_end, days.toUpperCase(), teacher_id);
  const subject = db.prepare('SELECT * FROM subjects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(subject);
});

router.put('/subjects/:id', ...adminOnly, (req, res) => {
  const { code, name, time_start, time_end, days, teacher_id } = req.body;
  const { id } = req.params;
  const sub = db.prepare('SELECT id FROM subjects WHERE id = ?').get(id);
  if (!sub) return res.status(404).json({ error: 'Subject not found' });

  const updates = []; const params = [];
  if (code)       { updates.push('code = ?');       params.push(code.trim()); }
  if (name)       { updates.push('name = ?');       params.push(name.trim()); }
  if (time_start) { updates.push('time_start = ?'); params.push(time_start); }
  if (time_end)   { updates.push('time_end = ?');   params.push(time_end); }
  if (days)       { updates.push('days = ?');       params.push(days.toUpperCase()); }
  if (teacher_id) { updates.push('teacher_id = ?'); params.push(teacher_id); }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
  params.push(id);
  db.prepare(`UPDATE subjects SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM subjects WHERE id = ?').get(id));
});

router.delete('/subjects/:id', ...adminOnly, (req, res) => {
  const result = db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Subject not found' });
  res.json({ success: true });
});

// ===== SECTIONS =====

router.get('/sections', ...adminOnly, (req, res) => {
  const sections = db.prepare(`
    SELECT sec.*, sub.code as subject_code, sub.name as subject_name,
      (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = sec.id) as enrollment_count
    FROM sections sec
    JOIN subjects sub ON sub.id = sec.subject_id
    ORDER BY sub.code, sec.name
  `).all();
  res.json(sections);
});

router.post('/sections', ...adminOnly, (req, res) => {
  const { subject_id, name, join_code } = req.body;
  if (!subject_id || !name) return res.status(400).json({ error: 'subject_id and name are required' });

  const code = join_code?.trim().toUpperCase() ||
    Math.random().toString(36).substring(2, 8).toUpperCase();

  try {
    const result = db.prepare(
      'INSERT INTO sections (subject_id, name, join_code) VALUES (?, ?, ?)'
    ).run(subject_id, name.trim(), code);
    res.status(201).json(db.prepare('SELECT * FROM sections WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Join code already in use' });
    throw err;
  }
});

router.put('/sections/:id', ...adminOnly, (req, res) => {
  const { name, join_code } = req.body;
  const { id } = req.params;
  if (!name && !join_code) return res.status(400).json({ error: 'Nothing to update' });

  const updates = []; const params = [];
  if (name)      { updates.push('name = ?');      params.push(name.trim()); }
  if (join_code) { updates.push('join_code = ?'); params.push(join_code.trim().toUpperCase()); }

  params.push(id);
  try {
    db.prepare(`UPDATE sections SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT * FROM sections WHERE id = ?').get(id));
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Join code already in use' });
    throw err;
  }
});

router.delete('/sections/:id', ...adminOnly, (req, res) => {
  const result = db.prepare('DELETE FROM sections WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Section not found' });
  res.json({ success: true });
});

// ===== ENROLLMENTS =====

router.get('/enrollments', ...adminOnly, (req, res) => {
  const enrollments = db.prepare(`
    SELECT e.id, e.student_id, e.section_id,
      u.name as student_name, u.email as student_email,
      sec.name as section_name, sub.code as subject_code, sub.name as subject_name
    FROM enrollments e
    JOIN users u ON u.id = e.student_id
    JOIN sections sec ON sec.id = e.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    ORDER BY sub.code, u.name
  `).all();
  res.json(enrollments);
});

router.post('/enrollments', ...adminOnly, (req, res) => {
  const { student_id, section_id } = req.body;
  if (!student_id || !section_id) return res.status(400).json({ error: 'student_id and section_id are required' });

  const student = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'STUDENT'").get(student_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const section = db.prepare('SELECT id FROM sections WHERE id = ?').get(section_id);
  if (!section) return res.status(404).json({ error: 'Section not found' });

  try {
    const result = db.prepare(
      'INSERT INTO enrollments (student_id, section_id) VALUES (?, ?)'
    ).run(student_id, section_id);
    res.status(201).json({ id: result.lastInsertRowid, student_id, section_id });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Student already enrolled in this section' });
    throw err;
  }
});

router.delete('/enrollments/:id', ...adminOnly, (req, res) => {
  const result = db.prepare('DELETE FROM enrollments WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Enrollment not found' });
  res.json({ success: true });
});

// ===== SESSIONS =====

router.get('/sessions', ...adminOnly, (req, res) => {
  const sessions = db.prepare(`
    SELECT
      asn.id, asn.section_id, asn.created_at, asn.expires_at, asn.finalized, asn.finalized_at,
      sec.name as section_name, sub.code as subject_code, sub.name as subject_name,
      u.name as professor_name,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = asn.id AND ar.status = 'PRESENT') as present_count,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = asn.id AND ar.status = 'ABSENT')  as absent_count,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = asn.id AND ar.status = 'PENDING') as pending_count,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.session_id = asn.id)                          as total_count
    FROM attendance_sessions asn
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    JOIN users u ON u.id = asn.teacher_id
    ORDER BY asn.created_at DESC
  `).all();
  res.json(sessions);
});

// GET /api/admin/sessions/:id/roster
router.get('/sessions/:id/roster', ...adminOnly, (req, res) => {
  const roster = db.prepare(`
    SELECT u.id, u.name, u.email,
      ar.status, ar.is_manual, ar.reason, ar.timestamp
    FROM attendance_records ar
    JOIN users u ON u.id = ar.student_id
    WHERE ar.session_id = ?
    ORDER BY u.name ASC
  `).all(req.params.id);
  res.json(roster);
});

// ===== AUDIT LOGS =====

router.get('/audit-logs', ...adminOnly, (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
  const logs  = db.prepare(`
    SELECT al.*,
      actor.name as actor_name, actor.role as actor_role,
      student.name as student_name
    FROM audit_logs al
    LEFT JOIN users actor   ON actor.id   = al.actor_id
    LEFT JOIN users student ON student.id = al.student_id
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json({ logs, total, page, totalPages: Math.ceil(total / limit) });
});

// ===== EXPORT =====

router.get('/export/:sessionId', ...adminOnly, (req, res) => {
  const { sessionId } = req.params;

  const session = db.prepare(`
    SELECT asn.id, sec.name as section_name, sub.code as subject_code, asn.created_at
    FROM attendance_sessions asn
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE asn.id = ?
  `).get(sessionId);

  if (!session) return res.status(404).json({ error: 'Session not found' });

  const records = db.prepare(`
    SELECT u.name, u.email, ar.status, ar.is_manual, ar.reason, ar.timestamp
    FROM attendance_records ar
    JOIN users u ON u.id = ar.student_id
    WHERE ar.session_id = ?
    ORDER BY u.name ASC
  `).all(sessionId);

  const lines = ['Name,Email,Status,Manual Override,Reason,Timestamp'];
  records.forEach(r => {
    lines.push([
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

router.get('/export/:sessionId/xlsx', ...adminOnly, (req, res) => {
  const { sessionId } = req.params;

  const session = db.prepare(`
    SELECT asn.id, asn.created_at,
           sec.name  AS section_name,
           sub.code  AS subject_code, sub.name AS subject_name,
           sub.time_start, sub.time_end, sub.days,
           u.name    AS professor_name
    FROM attendance_sessions asn
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    JOIN users u ON u.id = sub.teacher_id
    WHERE asn.id = ?
  `).get(sessionId);

  if (!session) return res.status(404).json({ error: 'Session not found' });

  const records = db.prepare(`
    SELECT u.name, u.email, ar.status, ar.is_manual, ar.reason, ar.timestamp
    FROM attendance_records ar
    JOIN users u ON u.id = ar.student_id
    WHERE ar.session_id = ?
    ORDER BY u.name ASC
  `).all(sessionId);

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

// ===== STATS =====

router.get('/stats', ...adminOnly, (req, res) => {
  const stats = {
    totalUsers:    db.prepare("SELECT COUNT(*) as c FROM users").get().c,
    totalStudents: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='STUDENT'").get().c,
    totalTeachers: db.prepare("SELECT COUNT(*) as c FROM users WHERE role='TEACHER'").get().c,
    totalSubjects: db.prepare("SELECT COUNT(*) as c FROM subjects").get().c,
    totalSections: db.prepare("SELECT COUNT(*) as c FROM sections").get().c,
    totalSessions: db.prepare("SELECT COUNT(*) as c FROM attendance_sessions").get().c,
    finalizedSessions: db.prepare("SELECT COUNT(*) as c FROM attendance_sessions WHERE finalized=1").get().c,
  };
  res.json(stats);
});

module.exports = router;
