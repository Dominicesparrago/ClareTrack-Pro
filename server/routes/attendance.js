const express = require('express');
const { DateTime } = require('luxon');
const db = require('../db');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();

function nowPH() {
  return DateTime.now().setZone('Asia/Manila');
}

function todayBoundariesUTC() {
  const now = nowPH();
  return {
    startUTC: now.startOf('day').toUTC().toISO(),
    endUTC: now.endOf('day').toUTC().toISO()
  };
}

// POST /api/attendance/start — professor creates 15-min session
router.post('/start', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { sectionId } = req.body;
  if (!sectionId) return res.status(400).json({ error: 'sectionId is required' });

  // Verify professor owns this section
  const section = db.prepare(`
    SELECT sec.id FROM sections sec
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE sec.id = ? AND sub.teacher_id = ?
  `).get(sectionId, req.session.userId);

  if (!section) return res.status(403).json({ error: 'You do not own this section' });

  // Check for existing session today (PH time)
  const { startUTC, endUTC } = todayBoundariesUTC();
  const existing = db.prepare(`
    SELECT id FROM attendance_sessions
    WHERE section_id = ? AND created_at >= ? AND created_at < ?
  `).get(sectionId, startUTC, endUTC);

  if (existing) {
    return res.status(409).json({ error: 'An attendance session already exists for this section today', sessionId: existing.id });
  }

  const now = nowPH();
  const createdAt = now.toUTC().toISO();
  const expiresAt = now.plus({ minutes: 15 }).toUTC().toISO();

  // Create session + pre-create PENDING records for all enrolled students in one transaction
  const insertSession = db.prepare(`
    INSERT INTO attendance_sessions (section_id, teacher_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertPending = db.prepare(`
    INSERT INTO attendance_records (session_id, student_id, status)
    SELECT ?, e.student_id, 'PENDING'
    FROM enrollments e
    WHERE e.section_id = ?
  `);

  let sessionId;
  const transaction = db.transaction(() => {
    const result = insertSession.run(sectionId, req.session.userId, createdAt, expiresAt);
    sessionId = result.lastInsertRowid;
    insertPending.run(sessionId, sectionId);
  });

  transaction();

  // Emit to section room
  const io = req.app.get('io');
  io.to(`section_${sectionId}`).emit('attendance_started', {
    sessionId,
    sectionId: parseInt(sectionId),
    expiresAt,
    createdAt
  });

  res.status(201).json({ sessionId, sectionId: parseInt(sectionId), expiresAt, createdAt });
});

// POST /api/attendance/mark — student marks themselves present
router.post('/mark', requireAuth, requireRole('STUDENT'), (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const studentId = req.session.userId;

  const session = db.prepare(`
    SELECT id, section_id, expires_at, finalized
    FROM attendance_sessions WHERE id = ?
  `).get(sessionId);

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.finalized === 1) return res.status(400).json({ error: 'This session has been finalized' });

  // Check expiry
  const expiresAt = DateTime.fromISO(session.expires_at, { zone: 'utc' });
  if (nowPH() > expiresAt) {
    return res.status(400).json({ error: 'This attendance session has expired' });
  }

  // Verify student is enrolled
  const enrolled = db.prepare(
    'SELECT id FROM enrollments WHERE student_id = ? AND section_id = ?'
  ).get(studentId, session.section_id);

  if (!enrolled) return res.status(403).json({ error: 'You are not enrolled in this section' });

  // Check current record status
  const record = db.prepare(
    'SELECT id, status FROM attendance_records WHERE session_id = ? AND student_id = ?'
  ).get(sessionId, studentId);

  if (record && record.status === 'PRESENT') {
    return res.status(409).json({ error: 'You have already marked your attendance' });
  }

  const timestamp = nowPH().toUTC().toISO();

  if (record) {
    db.prepare(`
      UPDATE attendance_records
      SET status = 'PRESENT', timestamp = ?, recorded_by = ?
      WHERE session_id = ? AND student_id = ?
    `).run(timestamp, studentId, sessionId, studentId);
  } else {
    db.prepare(`
      INSERT INTO attendance_records (session_id, student_id, status, timestamp, recorded_by)
      VALUES (?, ?, 'PRESENT', ?, ?)
    `).run(sessionId, studentId, timestamp, studentId);
  }

  // Emit update to section room
  const io = req.app.get('io');
  io.to(`section_${session.section_id}`).emit('attendance_update', {
    sessionId: parseInt(sessionId),
    studentId,
    status: 'PRESENT',
    timestamp,
    is_manual: 0
  });

  res.json({ success: true, timestamp });
});

// POST /api/attendance/override — professor manually sets student status
router.post('/override', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { sessionId, studentId, status, reason } = req.body;

  if (!sessionId || !studentId || !status) {
    return res.status(400).json({ error: 'sessionId, studentId, and status are required' });
  }
  if (!['PRESENT', 'ABSENT'].includes(status)) {
    return res.status(400).json({ error: 'Status must be PRESENT or ABSENT' });
  }
  if (!reason || reason.trim().length < 5) {
    return res.status(400).json({ error: 'Reason must be at least 5 characters' });
  }

  const session = db.prepare(`
    SELECT asn.id, asn.section_id, asn.finalized
    FROM attendance_sessions asn
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE asn.id = ? AND sub.teacher_id = ?
  `).get(sessionId, req.session.userId);

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.finalized === 1) return res.status(400).json({ error: 'Cannot override a finalized session' });

  const timestamp = nowPH().toUTC().toISO();

  const transaction = db.transaction(() => {
    const existing = db.prepare(
      'SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?'
    ).get(sessionId, studentId);

    if (existing) {
      db.prepare(`
        UPDATE attendance_records
        SET status = ?, is_manual = 1, reason = ?, timestamp = ?, recorded_by = ?
        WHERE session_id = ? AND student_id = ?
      `).run(status, reason.trim(), timestamp, req.session.userId, sessionId, studentId);
    } else {
      db.prepare(`
        INSERT INTO attendance_records (session_id, student_id, status, is_manual, reason, timestamp, recorded_by)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(sessionId, studentId, status, reason.trim(), timestamp, req.session.userId);
    }

    db.prepare(`
      INSERT INTO audit_logs (session_id, actor_id, student_id, action, reason, created_at)
      VALUES (?, ?, ?, 'MANUAL_OVERRIDE', ?, ?)
    `).run(sessionId, req.session.userId, studentId, reason.trim(), timestamp);
  });

  transaction();

  const io = req.app.get('io');
  io.to(`section_${session.section_id}`).emit('attendance_update', {
    sessionId: parseInt(sessionId),
    studentId: parseInt(studentId),
    status,
    timestamp,
    is_manual: 1,
    reason: reason.trim()
  });

  res.json({ success: true });
});

// POST /api/attendance/finalize — lock session permanently
router.post('/finalize', requireAuth, requireRole('TEACHER'), (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const session = db.prepare(`
    SELECT asn.id, asn.section_id, asn.finalized
    FROM attendance_sessions asn
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE asn.id = ? AND sub.teacher_id = ?
  `).get(sessionId, req.session.userId);

  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.finalized === 1) return res.status(400).json({ error: 'Session is already finalized' });

  const now = nowPH().toUTC().toISO();

  const transaction = db.transaction(() => {
    // Bulk-mark all remaining PENDING → ABSENT
    db.prepare(`
      UPDATE attendance_records
      SET status = 'ABSENT', timestamp = ?, recorded_by = ?
      WHERE session_id = ? AND status = 'PENDING'
    `).run(now, req.session.userId, sessionId);

    // Lock the session
    db.prepare(`
      UPDATE attendance_sessions
      SET finalized = 1, finalized_at = ?, finalized_by = ?
      WHERE id = ?
    `).run(now, req.session.userId, sessionId);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (session_id, actor_id, action, created_at)
      VALUES (?, ?, 'SESSION_FINALIZED', ?)
    `).run(sessionId, req.session.userId, now);
  });

  transaction();

  const io = req.app.get('io');
  io.to(`section_${session.section_id}`).emit('session_finalized', {
    sessionId: parseInt(sessionId),
    sectionId: session.section_id
  });

  res.json({ success: true });
});

// GET /api/attendance/active/:sectionId — check for active session
router.get('/active/:sectionId', requireAuth, (req, res) => {
  const { sectionId } = req.params;
  const nowISO = nowPH().toUTC().toISO();

  const session = db.prepare(`
    SELECT id, section_id, created_at, expires_at, finalized
    FROM attendance_sessions
    WHERE section_id = ? AND expires_at > ? AND finalized = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(sectionId, nowISO);

  res.json({ session: session || null });
});

// GET /api/attendance/session/:sessionId — get session details + student's record
router.get('/session/:sessionId', requireAuth, (req, res) => {
  const { sessionId } = req.params;
  const session = db.prepare(
    'SELECT * FROM attendance_sessions WHERE id = ?'
  ).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  let studentRecord = null;
  if (req.session.role === 'STUDENT') {
    studentRecord = db.prepare(
      'SELECT status, timestamp FROM attendance_records WHERE session_id = ? AND student_id = ?'
    ).get(sessionId, req.session.userId);
  }

  res.json({ session, studentRecord });
});

// GET /api/attendance/history/:studentId — student's full history
// Accepts optional ?from=YYYY-MM-DD&to=YYYY-MM-DD (PH timezone date strings)
router.get('/history/:studentId', requireAuth, (req, res) => {
  const { studentId } = req.params;
  const { from, to } = req.query;

  if (req.session.role === 'STUDENT' && parseInt(studentId) !== req.session.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const params = [studentId];
  let dateFilter = '';

  if (from) {
    const fromUTC = DateTime.fromISO(from, { zone: 'Asia/Manila' }).startOf('day').toUTC().toISO();
    dateFilter += ' AND asn.created_at >= ?';
    params.push(fromUTC);
  }
  if (to) {
    const toUTC = DateTime.fromISO(to, { zone: 'Asia/Manila' }).endOf('day').toUTC().toISO();
    dateFilter += ' AND asn.created_at <= ?';
    params.push(toUTC);
  }

  const records = db.prepare(`
    SELECT
      ar.id, ar.status, ar.is_manual, ar.reason, ar.timestamp,
      asn.created_at as session_date, asn.expires_at, asn.finalized,
      sub.id as subject_id, sub.code as subject_code, sub.name as subject_name,
      sub.days, sub.time_start, sub.time_end,
      sec.name as section_name
    FROM attendance_records ar
    JOIN attendance_sessions asn ON asn.id = ar.session_id
    JOIN sections sec ON sec.id = asn.section_id
    JOIN subjects sub ON sub.id = sec.subject_id
    WHERE ar.student_id = ? ${dateFilter}
    ORDER BY asn.created_at DESC
  `).all(...params);

  res.json(records);
});

module.exports = router;
