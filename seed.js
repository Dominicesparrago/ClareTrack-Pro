require('dotenv').config();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./server/db');

console.log('Seeding BSCS 2E demo data (AY 2025-2026, 2nd Semester)...');

const sessionsPath = path.resolve('./database/sessions.db');
if (fs.existsSync(sessionsPath)) {
  try {
    fs.unlinkSync(sessionsPath);
    console.log('Cleared sessions.db');
  } catch (e) {
    console.warn('Warning: could not delete sessions.db (server may be running) — skipping.');
  }
}

db.exec(`
  DELETE FROM audit_logs;
  DELETE FROM attendance_records;
  DELETE FROM attendance_sessions;
  DELETE FROM join_requests;
  DELETE FROM enrollments;
  DELETE FROM sections;
  DELETE FROM subjects;
  DELETE FROM users;
`);

const hash = (pw) => bcrypt.hashSync(pw, 10);
const insertUser = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)');

// --- ADMIN ---
insertUser.run('Administrator', 'admin@claretrack.edu', hash('Admin@1234'), 'ADMIN');

// --- PROFESSORS (7) — counter 1–7 ---
// Email: firstname.scc@gmail.com  |  Password: firstname+counter
// "Mark" conflicts with 2 students so use "markangelo" for Paredes
const professors = [
  { name: 'Sobremonte, Rilliana Jocas', fn: 'rilliana',   n: 1  },
  { name: 'Rafols, Richard',            fn: 'richard',    n: 2  },
  { name: 'Suaverdez, Sam Joshua',      fn: 'sam',        n: 3  },
  { name: 'Gatchalian, Jericho Ross',   fn: 'jericho',    n: 4  },
  { name: 'Altez, Jessa Mae',           fn: 'jessa',      n: 5  },
  { name: 'Relente, Janelle',           fn: 'janelle',    n: 6  },
  { name: 'Paredes, Mark Angelo',       fn: 'markangelo', n: 7  },
];

professors.forEach(p => { p.email = `${p.fn}.scc@gmail.com`; });

const profIdByEmail = {};
for (const p of professors) {
  const r = insertUser.run(p.name, p.email, hash(`${p.fn}${p.n}`), 'TEACHER');
  profIdByEmail[p.email] = r.lastInsertRowid;
}

// --- STUDENTS — 8 per section group (24 total) — counter 8–31 ---
// "Mark" → use marklester / markarron to avoid collision with markangelo
// "Justin Pearl" → justinpearl to avoid collision with plain "justin" (Dequeña)
const sectionGroups = {
  '2A': [
    { name: 'Abenoja, Jemuel',       fn: 'jemuel',      n: 8  },
    { name: 'Alanes, Gabriel',       fn: 'gabriel',     n: 9  },
    { name: 'Arañes, Mark Lester',   fn: 'marklester',  n: 10 },
    { name: 'Bohol, Mark Arron',     fn: 'markarron',   n: 11 },
    { name: 'Baloloy, Justin Pearl', fn: 'justinpearl', n: 12 },
    { name: 'Basilio, Hannah Kim',   fn: 'hannah',      n: 13 },
    { name: 'Bolon, Samantha',       fn: 'samantha',    n: 14 },
    { name: 'Bulanier, Lyrhine',     fn: 'lyrhine',     n: 15 },
  ],
  '2E': [
    { name: 'Calica, Mike Gerald',   fn: 'mike',        n: 16 },
    { name: 'Canda, Tricia Janen',   fn: 'tricia',      n: 17 },
    { name: 'Casim, Jenilyn',        fn: 'jenilyn',     n: 18 },
    { name: 'Cañete, Ryza Jane',     fn: 'ryza',        n: 19 },
    { name: 'Datu, Ara Lindzay',     fn: 'ara',         n: 20 },
    { name: 'Delim, Linus-Jake',     fn: 'linusjake',   n: 21 },
    { name: 'Dequeña, Justin',       fn: 'justin',      n: 22 },
    { name: 'Esparrago, Dominic',    fn: 'dominic',     n: 23 },
  ],
  '2G': [
    { name: 'Esparza, Ryzza',             fn: 'ryzza',      n: 24 },
    { name: 'Fuentes, Brando Miguel',     fn: 'brando',     n: 25 },
    { name: 'Fulgencio, Elaiza Lujhille', fn: 'elaiza',     n: 26 },
    { name: 'Galano, John Paul',          fn: 'john',       n: 27 },
    { name: 'Gultia, Jude Andrei',        fn: 'jude',       n: 28 },
    { name: 'Halili, Irwaynne Noelle',    fn: 'irwaynne',   n: 29 },
    { name: 'Jerusalem, James Leo',       fn: 'james',      n: 30 },
    { name: 'Malate, Vergie',             fn: 'vergie',     n: 31 },
  ],
};

for (const students of Object.values(sectionGroups)) {
  students.forEach(s => { s.email = `${s.fn}.scc@gmail.com`; });
}

const studentIdsByGroup = { '2A': [], '2E': [], '2G': [] };
for (const [grp, students] of Object.entries(sectionGroups)) {
  for (const s of students) {
    const r = insertUser.run(s.name, s.email, hash(`${s.fn}${s.n}`), 'STUDENT');
    studentIdsByGroup[grp].push(r.lastInsertRowid);
  }
}

// --- SUBJECTS ---
// days format: comma-separated MON/TUE/WED/THU/FRI (matches teacher.js DAY_MAP split logic)
const subjectDefs = [
  { code: 'CC105',     name: 'Computer Programming 2',                       start: '08:00', end: '09:00', days: 'MON,WED,FRI', email: 'richard.scc@gmail.com'     },
  { code: 'MATH ELE', name: 'Mathematics Elective',                          start: '09:00', end: '10:00', days: 'MON,WED,FRI', email: 'rilliana.scc@gmail.com'    },
  { code: 'AL101',    name: 'Algorithms and Logic',                          start: '10:00', end: '11:00', days: 'MON,WED,FRI', email: 'sam.scc@gmail.com'         },
  { code: 'GE9',      name: 'Gender and Society',                            start: '08:00', end: '09:30', days: 'TUE,THU',     email: 'jericho.scc@gmail.com'     },
  { code: 'GE10',     name: 'Philippine Literature in English',              start: '09:30', end: '11:00', days: 'TUE,THU',     email: 'jessa.scc@gmail.com'       },
  { code: 'PATHFIT4', name: 'Physical Activity Toward Health and Fitness 4', start: '13:00', end: '14:30', days: 'WED',         email: 'janelle.scc@gmail.com'     },
  { code: 'ITE401',   name: 'IT Elective 1',                                 start: '11:00', end: '12:00', days: 'MON,WED,FRI', email: 'markangelo.scc@gmail.com'  },
];

const insertSubject = db.prepare(
  'INSERT INTO subjects (code, name, time_start, time_end, days, teacher_id) VALUES (?, ?, ?, ?, ?, ?)'
);

const subjectIdByCode = {};
for (const s of subjectDefs) {
  const r = insertSubject.run(s.code, s.name, s.start, s.end, s.days, profIdByEmail[s.email]);
  subjectIdByCode[s.code] = r.lastInsertRowid;
}

// --- SECTIONS — 3 per subject (2A, 2E, 2G) ---
const insertSection = db.prepare('INSERT INTO sections (subject_id, name, join_code) VALUES (?, ?, ?)');

const sectionId = {}; // sectionId[subjectCode][groupName]
for (const s of subjectDefs) {
  sectionId[s.code] = {};
  for (const grp of ['2A', '2E', '2G']) {
    const joinCode = (s.code.replace(/[^A-Z0-9]/gi, '') + grp).toUpperCase();
    const r = insertSection.run(subjectIdByCode[s.code], grp, joinCode);
    sectionId[s.code][grp] = r.lastInsertRowid;
  }
}

// --- ENROLLMENTS — each student enrolled in all 7 subjects for their group ---
const insertEnrollment = db.prepare('INSERT OR IGNORE INTO enrollments (student_id, section_id) VALUES (?, ?)');
for (const [grp, ids] of Object.entries(studentIdsByGroup)) {
  for (const sid of ids) {
    for (const s of subjectDefs) {
      insertEnrollment.run(sid, sectionId[s.code][grp]);
    }
  }
}

// --- ATTENDANCE SESSIONS & RECORDS ---
// Date range: March 8 – April 27, 2026
// All times stored in UTC (Asia/Manila = UTC+8)
const START_DATE = '2026-03-08';
const END_DATE   = '2026-04-27';

function toUTC(dateStr, timeStr) {
  // Convert Asia/Manila local time to UTC ISO string
  return new Date(`${dateStr}T${timeStr}:00+08:00`).toISOString();
}

const DAY_NUM_MAP = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5 };

function getSessionDates(daysStr, startStr, endStr) {
  const nums = daysStr.split(',').map(d => DAY_NUM_MAP[d.trim()]);
  const start = new Date(startStr + 'T00:00:00Z');
  const end   = new Date(endStr   + 'T00:00:00Z');
  const dates = [];
  const cur = new Date(start);
  while (cur <= end) {
    if (nums.includes(cur.getUTCDay())) {
      dates.push(cur.toISOString().split('T')[0]);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

const insertSession = db.prepare(`
  INSERT INTO attendance_sessions
    (section_id, teacher_id, created_at, expires_at, finalized, finalized_at, finalized_by)
  VALUES (?, ?, ?, ?, 1, ?, ?)
`);

const insertRecord = db.prepare(`
  INSERT INTO attendance_records (session_id, student_id, status, is_manual, timestamp, recorded_by)
  VALUES (?, ?, ?, 0, ?, ?)
`);

// Deterministic LCG for reproducible ~85% attendance rate
let rngSeed = 20260308;
function rng() {
  rngSeed = (Math.imul(rngSeed, 1664525) + 1013904223) >>> 0;
  return rngSeed / 0x100000000;
}

// Wrap all inserts in a single transaction for performance
db.transaction(() => {
  for (const sub of subjectDefs) {
    const teacherId = profIdByEmail[sub.email];
    const dates = getSessionDates(sub.days, START_DATE, END_DATE);

    for (const grp of ['2A', '2E', '2G']) {
      const secId = sectionId[sub.code][grp];
      const enrolledIds = studentIdsByGroup[grp];

      for (const dateStr of dates) {
        const createdAt = toUTC(dateStr, sub.start);
        const expiresAt = toUTC(dateStr, sub.end);

        const sess = insertSession.run(secId, teacherId, createdAt, expiresAt, expiresAt, teacherId);
        const sessionId = sess.lastInsertRowid;

        for (const studentId of enrolledIds) {
          const present   = rng() < 0.85;
          const status    = present ? 'PRESENT' : 'ABSENT';
          const timestamp = present ? createdAt : null;
          insertRecord.run(sessionId, studentId, status, timestamp, teacherId);
        }
      }
    }
  }
})();

// --- SUMMARY ---
console.log('\n========================================');
console.log(' BSCS 2E Demo Seed Complete');
console.log(' AY 2025-2026 | 2nd Semester');
console.log(' Data range: March 8 – April 27, 2026');
console.log('========================================\n');

console.log('Admin Account:');
console.log('  Email:    admin@claretrack.edu');
console.log('  Password: Admin@1234\n');

console.log('Professors');
console.log('─────────────────────────────────────────────────────────────────');
const subjectByEmail = {};
for (const s of subjectDefs) subjectByEmail[s.email] = `${s.code} (${s.days})`;
professors.forEach(p => {
  console.log(`  ${p.name.padEnd(30)} → ${subjectByEmail[p.email]}`);
  console.log(`    Email:    ${p.email}`);
  console.log(`    Password: ${p.fn}${p.n}`);
});

console.log('\nStudents');
console.log('─────────────────────────────────────────────────────────────────');
for (const [grp, students] of Object.entries(sectionGroups)) {
  console.log(`\n  Section ${grp} (enrolled in all 7 subjects):`);
  students.forEach(s =>
    console.log(`    ${s.name.padEnd(30)}  ${s.email}  /  ${s.fn}${s.n}`)
  );
}

const sessionCount = db.prepare('SELECT COUNT(*) as c FROM attendance_sessions').get().c;
const recordCount  = db.prepare('SELECT COUNT(*) as c FROM attendance_records').get().c;
const presentCount = db.prepare("SELECT COUNT(*) as c FROM attendance_records WHERE status='PRESENT'").get().c;
console.log('\n─────────────────────────────────────────────────────────────────');
console.log(`  Sessions generated : ${sessionCount}`);
console.log(`  Attendance records : ${recordCount}`);
console.log(`  Overall attendance : ${(presentCount / recordCount * 100).toFixed(1)}% present`);
console.log('');
