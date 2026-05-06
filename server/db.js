require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './database/attendance.db';
const dbDir = path.dirname(path.resolve(DB_PATH));

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT    NOT NULL,
    role       TEXT    NOT NULL CHECK(role IN ('ADMIN','TEACHER','STUDENT')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subjects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    time_start  TEXT    NOT NULL,
    time_end    TEXT    NOT NULL,
    days        TEXT    NOT NULL,
    teacher_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id  INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    join_code   TEXT    NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section_id  INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    UNIQUE(student_id, section_id)
  );

  CREATE TABLE IF NOT EXISTS attendance_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id   INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    teacher_id   INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT    NOT NULL,
    expires_at   TEXT    NOT NULL,
    finalized    INTEGER NOT NULL DEFAULT 0,
    finalized_at TEXT,
    finalized_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id  INTEGER NOT NULL REFERENCES users(id),
    status      TEXT    NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PRESENT','ABSENT','PENDING')),
    is_manual   INTEGER NOT NULL DEFAULT 0,
    reason      TEXT,
    timestamp   TEXT,
    recorded_by INTEGER REFERENCES users(id),
    UNIQUE(session_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER REFERENCES attendance_sessions(id),
    actor_id    INTEGER NOT NULL REFERENCES users(id),
    student_id  INTEGER REFERENCES users(id),
    action      TEXT    NOT NULL,
    reason      TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
