const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();

// GET /api/student/sections — enrolled sections with subject info
router.get('/sections', requireAuth, requireRole('STUDENT'), (req, res) => {
  const sections = db.prepare(`
    SELECT
      sec.id, sec.name as section_name, sec.join_code,
      sub.code as subject_code, sub.name as subject_name,
      sub.time_start, sub.time_end, sub.days,
      u.name as professor_name
    FROM enrollments e
    JOIN sections sec ON sec.id = e.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    JOIN users u ON u.id = sub.teacher_id
    WHERE e.student_id = ?
    ORDER BY sub.code ASC
  `).all(req.session.userId);

  res.json(sections);
});

// GET /api/student/join-preview?code=ABC123 — preview section info before enrolling
router.get('/join-preview', requireAuth, requireRole('STUDENT'), (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  if (code.length !== 6) return res.status(400).json({ error: 'Join code must be 6 characters' });

  const section = db.prepare(`
    SELECT sec.id, sec.name AS section_name, sec.join_code,
           sub.code AS subject_code, sub.name AS subject_name,
           sub.time_start, sub.time_end, sub.days,
           u.name AS professor_name,
           (SELECT COUNT(*) FROM enrollments e WHERE e.section_id = sec.id) AS enrolled_count
    FROM sections sec
    JOIN subjects sub ON sub.id = sec.subject_id
    JOIN users u ON u.id = sub.teacher_id
    WHERE sec.join_code = ?
  `).get(code);

  if (!section) return res.status(404).json({ error: 'Invalid join code. Section not found.' });

  const existing = db.prepare(
    'SELECT id FROM enrollments WHERE student_id = ? AND section_id = ?'
  ).get(req.session.userId, section.id);

  if (existing) return res.status(409).json({ error: 'You are already enrolled in this section.' });

  res.json(section);
});

// POST /api/student/join — submit a join request (teacher must approve)
router.post('/join', requireAuth, requireRole('STUDENT'), (req, res) => {
  const { joinCode } = req.body;
  if (!joinCode || joinCode.trim().length !== 6) {
    return res.status(400).json({ error: 'Join code must be exactly 6 characters' });
  }

  const section = db.prepare(
    'SELECT sec.id, sec.name, sec.subject_id FROM sections sec WHERE sec.join_code = ?'
  ).get(joinCode.trim().toUpperCase());

  if (!section) return res.status(404).json({ error: 'Invalid join code. Section not found.' });

  const enrolled = db.prepare(
    'SELECT id FROM enrollments WHERE student_id = ? AND section_id = ?'
  ).get(req.session.userId, section.id);
  if (enrolled) return res.status(409).json({ error: 'You are already enrolled in this section.' });

  const pending = db.prepare(
    "SELECT id FROM join_requests WHERE student_id = ? AND section_id = ? AND status = 'PENDING'"
  ).get(req.session.userId, section.id);
  if (pending) return res.status(409).json({ error: 'You already have a pending request for this section.' });

  const result = db.prepare(
    "INSERT INTO join_requests (student_id, section_id, status, created_at) VALUES (?, ?, 'PENDING', datetime('now'))"
  ).run(req.session.userId, section.id);

  // Emit real-time notification to teacher
  const io = req.app.get('io');
  const student = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.session.userId);
  const subject = db.prepare('SELECT code, name, teacher_id FROM subjects WHERE id = ?').get(section.subject_id);
  io.to(`user_${subject.teacher_id}`).emit('join_request_new', {
    requestId:   result.lastInsertRowid,
    studentId:   student.id,
    studentName: student.name,
    studentEmail:student.email,
    sectionId:   section.id,
    sectionName: section.name,
    subjectCode: subject.code,
    subjectName: subject.name
  });

  res.status(202).json({ pending: true, message: 'Request sent. Waiting for professor approval.' });
});

// GET /api/student/subjects — distinct subjects the student is enrolled in
router.get('/subjects', requireAuth, requireRole('STUDENT'), (req, res) => {
  const subjects = db.prepare(`
    SELECT DISTINCT sub.id, sub.code, sub.name, sub.days, sub.time_start, sub.time_end
    FROM enrollments e
    JOIN sections sec ON sec.id = e.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE e.student_id = ?
    ORDER BY sub.code ASC
  `).all(req.session.userId);
  res.json(subjects);
});

module.exports = router;
