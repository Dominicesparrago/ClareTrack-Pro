# ClareTrack Pro

Real-time Student Attendance Monitoring System for Philippine universities.

## Prerequisites

- Node.js v18+
- npm v9+

## Installation

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and set SESSION_SECRET
cp .env.example .env

# 3. Seed the database with test data
npm run seed

# 4. Start the server
npm start
```

Open: http://localhost:3000

## Development

```bash
npm run dev   # nodemon auto-restart
```

## Test Accounts

| Role          | Email                         | Password      |
|---------------|-------------------------------|---------------|
| Administrator | admin@claretrack.edu          | Admin@1234    |
| Professor     | teacher1@claretrack.edu       | Teacher@1234  |
| Professor     | teacher2@claretrack.edu       | Teacher@1234  |
| Student       | student1@claretrack.edu       | Student@1234  |
| Student       | student2–10@claretrack.edu    | Student@1234  |

## Architecture

- **Backend**: Node.js + Express.js (CommonJS)
- **Database**: SQLite3 via `better-sqlite3` (WAL mode)
- **Real-time**: Socket.IO v4 (rooms scoped per section)
- **Auth**: `express-session` + `bcryptjs`
- **Time**: `luxon` (Asia/Manila UTC+8)
- **Frontend**: Pure HTML5 + CSS3 + Vanilla JS

## Key Features

- Professors request attendance per session (15-minute window)
- Students mark themselves present from their own device
- Live roster updates via Socket.IO
- Manual override with required reason + audit log
- Session finalization locks records permanently
- Auto-mark absent on session expiry (60s background check)
- Student self-enrollment via 6-character join codes
- Admin panel: full CRUD, audit logs, CSV export
- Mobile-responsive layout (375px – 1280px)
