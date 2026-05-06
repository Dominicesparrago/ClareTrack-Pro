require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./server/db');

console.log('Seeding database...');

// Clear existing data in dependency order
db.exec(`
  DELETE FROM audit_logs;
  DELETE FROM attendance_records;
  DELETE FROM attendance_sessions;
  DELETE FROM enrollments;
  DELETE FROM sections;
  DELETE FROM subjects;
  DELETE FROM users;
`);

const hash = (pw) => bcrypt.hashSync(pw, 12);

const insertUser = db.prepare(
  'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
);

// Admin
insertUser.run('Administrator', 'admin@claretrack.edu', hash('Admin@1234'), 'ADMIN');

// Professors
const t1Result = insertUser.run('Prof. Santos', 'teacher1@claretrack.edu', hash('Teacher@1234'), 'TEACHER');
const t2Result = insertUser.run('Prof. Reyes', 'teacher2@claretrack.edu', hash('Teacher@1234'), 'TEACHER');
const t1Id = t1Result.lastInsertRowid;
const t2Id = t2Result.lastInsertRowid;

// Students
const studentIds = [];
for (let i = 1; i <= 10; i++) {
  const r = insertUser.run(
    `Student ${i}`,
    `student${i}@claretrack.edu`,
    hash('Student@1234'),
    'STUDENT'
  );
  studentIds.push(r.lastInsertRowid);
}

// Subjects
const insertSubject = db.prepare(
  'INSERT INTO subjects (code, name, time_start, time_end, days, teacher_id) VALUES (?, ?, ?, ?, ?, ?)'
);

const subjectsData = [
  ['CC105',     'Computer Programming 1',                         '10:00', '11:00', 'MON,WED,FRI', t1Id],
  ['MATH ELE',  'Mathematics in the Modern World',                '10:00', '12:00', 'MON,WED,FRI', t2Id],
  ['AL101',     'Algorithms and Logic',                           '10:00', '11:00', 'MON,WED,FRI', t1Id],
  ['GE10',      'Ethics and Moral Reasoning',                     '10:00', '11:30', 'TUE,THU',     t1Id],
  ['GE9',       'The Contemporary World',                         '10:00', '11:00', 'TUE,THU',     t2Id],
  ['PATHFIT4',  'Physical Activity Towards Health & Fitness 4',   '15:00', '17:00', 'WED',         t2Id],
];

const subjectIds = subjectsData.map(s => insertSubject.run(...s).lastInsertRowid);

// Generate a random 6-char uppercase join code
function randomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Sections (1 per subject)
const insertSection = db.prepare(
  'INSERT INTO sections (subject_id, name, join_code) VALUES (?, ?, ?)'
);

const sectionNames = ['CC105-A', 'MATHELE-A', 'AL101-A', 'GE10-A', 'GE9-A', 'PATHFIT4-A'];
const sectionIds = subjectIds.map((sid, i) =>
  insertSection.run(sid, sectionNames[i], randomCode()).lastInsertRowid
);

// Enrollments
const insertEnrollment = db.prepare(
  'INSERT INTO enrollments (student_id, section_id) VALUES (?, ?)'
);

// Students 1–5 → CC105-A (index 0) and GE10-A (index 3)
for (let i = 0; i < 5; i++) {
  insertEnrollment.run(studentIds[i], sectionIds[0]);
  insertEnrollment.run(studentIds[i], sectionIds[3]);
}

// Students 6–10 → MATH ELE-A (index 1) and PATHFIT4-A (index 5)
for (let i = 5; i < 10; i++) {
  insertEnrollment.run(studentIds[i], sectionIds[1]);
  insertEnrollment.run(studentIds[i], sectionIds[5]);
}

// Additional cross-enrollments for realistic data
insertEnrollment.run(studentIds[0], sectionIds[2]); // Student 1 in AL101-A
insertEnrollment.run(studentIds[1], sectionIds[2]); // Student 2 in AL101-A
insertEnrollment.run(studentIds[2], sectionIds[4]); // Student 3 in GE9-A
insertEnrollment.run(studentIds[5], sectionIds[3]); // Student 6 in GE10-A
insertEnrollment.run(studentIds[6], sectionIds[0]); // Student 7 in CC105-A

// Print section join codes for reference
console.log('\n=== Seed Complete ===\n');
const sections = db.prepare('SELECT s.name, s.join_code, sub.code FROM sections s JOIN subjects sub ON sub.id = s.subject_id').all();
console.log('Section Join Codes:');
sections.forEach(s => console.log(`  ${s.code} / ${s.name}: ${s.join_code}`));

console.log('\nTest Accounts:');
console.log('  Admin:     admin@claretrack.edu       / Admin@1234');
console.log('  Professor: teacher1@claretrack.edu    / Teacher@1234');
console.log('  Professor: teacher2@claretrack.edu    / Teacher@1234');
console.log('  Students:  student1-10@claretrack.edu / Student@1234');
console.log('');
