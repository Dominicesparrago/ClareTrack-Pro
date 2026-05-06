require('dotenv').config();
const express = require('express');
const http = require('http');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');

// db.js must be required first — creates ./database directory and schema
const db = require('./db');

const app = express();
const server = http.createServer(app);

// Ensure database directory exists for session store
const dbDir = path.resolve('./database');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// Init Socket.IO before applying session middleware
const { initSocket } = require('./socket');
const io = initSocket(server);

// Make io accessible to route handlers
app.set('io', io);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware — single instance shared with Socket.IO
const sessionMiddleware = session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './database' }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);

// Share session middleware with Socket.IO
io.engine.use(sessionMiddleware);

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/student', require('./routes/student'));
app.use('/api/attendance', require('./routes/attendance'));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all: serve index.html for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ClareTrack Pro running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
