require('dotenv').config();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./server/db');

console.log('Initializing database...');

// Wipe sessions so stale role/userId data doesn't linger after a re-seed
const sessionsPath = path.resolve('./database/sessions.db');
if (fs.existsSync(sessionsPath)) {
  fs.unlinkSync(sessionsPath);
  console.log('Cleared sessions.db');
}

// Clear all data in dependency order
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

// Official admin account
insertUser.run('Administrator', 'admin@claretrack.edu', hash('Admin@1234'), 'ADMIN');

console.log('\n=== Initialization Complete ===\n');
console.log('Admin Account:');
console.log('  Email:    admin@claretrack.edu');
console.log('  Password: Admin@1234');
console.log('');
console.log('Teachers and students can be created through the admin dashboard.');
console.log('');
