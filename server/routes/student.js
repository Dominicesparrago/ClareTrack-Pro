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

// POST /api/student/join — enroll in a section by join code
router.post('/join', requireAuth, requireRole('STUDENT'), (req, res) => {
  const { joinCode } = req.body;
  if (!joinCode || joinCode.trim().length !== 6) {
    return res.status(400).json({ error: 'Join code must be exactly 6 characters' });
  }

  const section = db.prepare(
    'SELECT id, name, subject_id FROM sections WHERE join_code = ?'
  ).get(joinCode.trim().toUpperCase());

  if (!section) return res.status(404).json({ error: 'Invalid join code. Section not found.' });

  const existing = db.prepare(
    'SELECT id FROM enrollments WHERE student_id = ? AND section_id = ?'
  ).get(req.session.userId, section.id);

  if (existing) return res.status(409).json({ error: 'You are already enrolled in this section' });

  db.prepare(
    'INSERT INTO enrollments (student_id, section_id) VALUES (?, ?)'
  ).run(req.session.userId, section.id);

  const subject = db.prepare('SELECT code, name FROM subjects WHERE id = ?').get(section.subject_id);

  res.status(201).json({
    success: true,
    section: { id: section.id, name: section.name },
    subject: subject
  });
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
