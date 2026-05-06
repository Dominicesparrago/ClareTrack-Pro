const { Server } = require('socket.io');
const { DateTime } = require('luxon');
const db = require('./db');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: false }
  });

  io.on('connection', (socket) => {
    const session = socket.request.session;

    if (!session || !session.userId) {
      socket.disconnect(true);
      return;
    }

    socket.on('join_section', (sectionId) => {
      const sid = parseInt(sectionId);
      if (!sid || isNaN(sid)) return;

      const userId = session.userId;
      const role = session.role;
      let authorized = false;

      if (role === 'STUDENT') {
        const enrollment = db.prepare(
          'SELECT id FROM enrollments WHERE student_id = ? AND section_id = ?'
        ).get(userId, sid);
        authorized = !!enrollment;
      } else if (role === 'TEACHER') {
        const section = db.prepare(`
          SELECT sec.id FROM sections sec
          JOIN subjects sub ON sub.id = sec.subject_id
          WHERE sec.id = ? AND sub.teacher_id = ?
        `).get(sid, userId);
        authorized = !!section;
      } else if (role === 'ADMIN') {
        authorized = true;
      }

      if (authorized) {
        socket.join(`section_${sid}`);
        socket.emit('joined', { sectionId: sid });
      }
    });

    socket.on('leave_section', (sectionId) => {
      socket.leave(`section_${parseInt(sectionId)}`);
    });
  });

  // Auto-mark expired PENDING → ABSENT every 60 seconds
  const interval = setInterval(() => autoMarkExpired(io), 60 * 1000);

  process.on('SIGTERM', () => clearInterval(interval));
  process.on('SIGINT', () => clearInterval(interval));

  return io;
}

function autoMarkExpired(io) {
  const now = DateTime.now().setZone('Asia/Manila').toUTC().toISO();

  const expiredSessions = db.prepare(`
    SELECT DISTINCT asn.id, asn.section_id
    FROM attendance_sessions asn
    JOIN attendance_records ar ON ar.session_id = asn.id
    WHERE asn.expires_at < ?
    AND asn.finalized = 0
    AND ar.status = 'PENDING'
  `).all(now);

  if (expiredSessions.length === 0) return;

  const markAbsent = db.prepare(`
    UPDATE attendance_records
    SET status = 'ABSENT', timestamp = ?
    WHERE session_id = ? AND status = 'PENDING'
  `);

  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (session_id, actor_id, action, created_at)
    VALUES (?, 1, 'AUTO_MARKED_ABSENT', ?)
  `);

  const transaction = db.transaction((sessions) => {
    for (const session of sessions) {
      markAbsent.run(now, session.id);
      insertAudit.run(session.id, now);
    }
  });

  transaction(expiredSessions);

  for (const session of expiredSessions) {
    io.to(`section_${session.section_id}`).emit('session_expired', {
      sessionId: session.id,
      sectionId: session.section_id
    });
  }
}

module.exports = { initSocket };
