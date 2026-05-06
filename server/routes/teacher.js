const express = require('express');
const { DateTime } = require('luxon');
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

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

// GET /api/teacher/subjects/all — all subjects for the logged-in professor (not day-filtered)
router.get('/subjects/all', requireAuth, requireRole('TEACHER'), (req, res) => {
  const subjects = db.prepare(`
    SELECT s.id, s.code, s.name, s.time_start, s.time_end, s.days
    FROM subjects s
    WHERE s.teacher_id = ?
    ORDER BY s.code
  `).all(req.session.userId);
  res.json(subjects);
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

module.exports = router;
