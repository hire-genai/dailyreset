require('dotenv').config();
const express  = require('express');
const path     = require('path');
const crypto   = require('crypto');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const jwt      = require('jsonwebtoken');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const DEV_MODE   = process.env.DEV_MODE === 'true';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DATABASE ──────────────────────────────────────────────────────────────────
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const db = new Database(path.join(dbDir, 'dailyreset.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    UNIQUE NOT NULL,
    display_name TEXT,
    name         TEXT,
    phone        TEXT,
    created_at   TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS habits (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    date      TEXT    NOT NULL,
    habit_id  TEXT    NOT NULL,
    completed INTEGER DEFAULT 1,
    UNIQUE(user_id, date, habit_id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS weights (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    date      TEXT    NOT NULL,
    weight_kg REAL    NOT NULL,
    UNIQUE(user_id, date),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id      INTEGER PRIMARY KEY,
    diet_type    TEXT NOT NULL DEFAULT 'veg',
    proteins     TEXT NOT NULL DEFAULT '[]',
    veggies      TEXT NOT NULL DEFAULT '[]',
    carbs        TEXT NOT NULL DEFAULT '[]',
    meal_variety TEXT NOT NULL DEFAULT 'same',
    updated_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

try { db.prepare(`ALTER TABLE users ADD COLUMN name TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE users ADD COLUMN phone TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE profiles ADD COLUMN meal_variety TEXT DEFAULT 'same'`).run(); } catch {}

// ── HELPERS ───────────────────────────────────────────────────────────────────
const ANIMAL_ADJ  = ['Bold','Swift','Strong','Brave','Calm','Lean','Fit','Sharp','Cool','Bright'];
const ANIMAL_NOUN = ['Tiger','Eagle','Wolf','Bear','Fox','Lion','Hawk','Panda','Deer','Crane'];

function anonymousName(userId) {
  const a = ANIMAL_ADJ[userId % ANIMAL_ADJ.length];
  const n = ANIMAL_NOUN[Math.floor(userId / ANIMAL_ADJ.length) % ANIMAL_NOUN.length];
  return `${a}${n}`;
}

function makeOtp() {
  return String(Math.floor(100000 + crypto.randomInt(900000)));
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

// Middleware — parse Bearer token
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

// ── EMAIL ─────────────────────────────────────────────────────────────────────
let transporter = null;
if (!DEV_MODE && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendOtpEmail(email, code) {
  if (DEV_MODE || !transporter) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  OTP for ${email}: ${code}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"Daily Reset" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Your Daily Reset login code: ${code}`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;background:#0f1117;color:#e2e8f0;padding:32px;border-radius:12px">
        <h2 style="color:#6c63ff;margin:0 0 8px">Daily Reset</h2>
        <p style="color:#8892b0;margin:0 0 24px;font-size:14px">Your one-time login code</p>
        <div style="background:#22263a;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#6c63ff">${code}</span>
        </div>
        <p style="color:#8892b0;font-size:13px">This code expires in 10 minutes. Never share it with anyone.</p>
      </div>`,
  });
}

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────

// Request OTP
app.post('/auth/request-otp', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Rate limit: max 3 OTPs per email per 15 minutes
  const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const recent = db.prepare(
    `SELECT COUNT(*) as c FROM otp_codes WHERE email = ? AND expires_at > ?`
  ).get(email, fifteenAgo);
  if (recent.c >= 3) {
    return res.status(429).json({ error: 'Too many requests. Wait 15 minutes.' });
  }

  const code    = makeOtp();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)`)
    .run(email, code, expires);

  try {
    await sendOtpEmail(email, code);
    res.json({ ok: true, dev: DEV_MODE || !transporter });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: 'Failed to send email. Check SMTP config in .env' });
  }
});

// Verify OTP
app.post('/auth/verify-otp', (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const code  = (req.body.code  || '').trim();
  const now   = new Date().toISOString();

  const row = db.prepare(
    `SELECT * FROM otp_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1`
  ).get(email, code, now);

  if (!row) return res.status(401).json({ error: 'Invalid or expired code' });

  // Mark used
  db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);

  // Upsert user
  let isNewUser = false;
  let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (!user) {
    isNewUser = true;
    const r = db.prepare(`INSERT INTO users (email) VALUES (?)`).run(email);
    const newId = r.lastInsertRowid;
    const displayName = anonymousName(newId);
    db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(displayName, newId);
    user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(newId);
  }

  const token = signToken(user);
  res.json({ token, isNewUser, user: { id: user.id, displayName: user.display_name, email: user.email } });
});

// ── USER PROFILE ──────────────────────────────────────────────────────────────
app.get('/api/me', auth, (req, res) => {
  const user = db.prepare(`SELECT id, email, display_name, created_at FROM users WHERE id = ?`).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, email: user.email, displayName: user.display_name, name: user.name, phone: user.phone, createdAt: user.created_at });
});

// Update name / phone
app.patch('/api/me', auth, (req, res) => {
  const name  = (req.body.name  || '').trim() || null;
  const phone = (req.body.phone || '').trim() || null;
  db.prepare(`UPDATE users SET name = ?, phone = ? WHERE id = ?`).run(name, phone, req.user.id);
  res.json({ ok: true });
});

// ── HABITS API ────────────────────────────────────────────────────────────────

// GET /api/habits?from=YYYY-MM-DD&to=YYYY-MM-DD
app.get('/api/habits', auth, (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = db.prepare(
      `SELECT date, habit_id, completed FROM habits WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date`
    ).all(req.user.id, from, to);
  } else {
    rows = db.prepare(
      `SELECT date, habit_id, completed FROM habits WHERE user_id = ? ORDER BY date DESC LIMIT 500`
    ).all(req.user.id);
  }
  // Group by date
  const result = {};
  rows.forEach(r => {
    if (!result[r.date]) result[r.date] = {};
    result[r.date][r.habit_id] = !!r.completed;
  });
  res.json(result);
});

// POST /api/habits  { date, habitId, completed }
app.post('/api/habits', auth, (req, res) => {
  const { date, habitId, completed } = req.body;
  if (!date || !habitId) return res.status(400).json({ error: 'date and habitId required' });
  if (completed) {
    db.prepare(
      `INSERT INTO habits (user_id, date, habit_id, completed) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id, date, habit_id) DO UPDATE SET completed = 1`
    ).run(req.user.id, date, habitId);
  } else {
    db.prepare(
      `INSERT INTO habits (user_id, date, habit_id, completed) VALUES (?, ?, ?, 0)
       ON CONFLICT(user_id, date, habit_id) DO UPDATE SET completed = 0`
    ).run(req.user.id, date, habitId);
  }
  res.json({ ok: true });
});

// POST /api/habits/bulk  { data: { "YYYY-MM-DD": { habitId: true/false } } }
app.post('/api/habits/bulk', auth, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'data required' });
  const insert = db.prepare(
    `INSERT INTO habits (user_id, date, habit_id, completed) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, date, habit_id) DO UPDATE SET completed = excluded.completed`
  );
  const bulk = db.transaction(() => {
    for (const [date, habits] of Object.entries(data)) {
      for (const [habitId, completed] of Object.entries(habits)) {
        insert.run(req.user.id, date, habitId, completed ? 1 : 0);
      }
    }
  });
  bulk();
  res.json({ ok: true });
});

// ── WEIGHT API ────────────────────────────────────────────────────────────────

app.get('/api/weights', auth, (req, res) => {
  const rows = db.prepare(
    `SELECT date, weight_kg FROM weights WHERE user_id = ? ORDER BY date DESC LIMIT 90`
  ).all(req.user.id);
  res.json(rows);
});

app.post('/api/weight', auth, (req, res) => {
  const { date, weight } = req.body;
  if (!date || !weight) return res.status(400).json({ error: 'date and weight required' });
  db.prepare(
    `INSERT INTO weights (user_id, date, weight_kg) VALUES (?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg`
  ).run(req.user.id, date, weight);
  res.json({ ok: true });
});

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
// Returns anonymized stats — no email or PII ever exposed

app.get('/api/leaderboard', auth, (req, res) => {
  const totalHabits = 23; // keep in sync with frontend HABITS array

  // Week range (last 7 days)
  const dates = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const weekStart = dates[0], weekEnd = dates[6];

  // Per-user weekly completion
  const userStats = db.prepare(`
    SELECT
      u.id,
      u.display_name,
      COUNT(CASE WHEN h.completed = 1 THEN 1 END) as done_count,
      COUNT(DISTINCT CASE WHEN h.completed = 1 THEN h.date END) as active_days
    FROM users u
    LEFT JOIN habits h ON h.user_id = u.id AND h.date BETWEEN ? AND ?
    GROUP BY u.id
  `).all(weekStart, weekEnd);

  const maxPossible = totalHabits * 7;

  const ranked = userStats
    .map(u => ({
      id:          u.id,
      displayName: u.display_name,
      weekPct:     Math.round((u.done_count / maxPossible) * 100),
      activeDays:  u.active_days,
      isMe:        u.id === req.user.id,
    }))
    .sort((a, b) => b.weekPct - a.weekPct);

  // Assign ranks
  let rank = 0, prev = -1;
  ranked.forEach((u, i) => {
    if (u.weekPct !== prev) { rank = i + 1; prev = u.weekPct; }
    u.rank = rank;
  });

  const total = ranked.length;
  const me    = ranked.find(u => u.isMe);
  const myRank = me ? me.rank : null;
  const betterThan = me ? Math.round(((total - myRank) / Math.max(total - 1, 1)) * 100) : 0;

  // Streaks per user (last 30 days)
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const streakRows = db.prepare(`
    SELECT user_id, date, COUNT(CASE WHEN completed=1 THEN 1 END) as done
    FROM habits
    WHERE date >= ?
    GROUP BY user_id, date
  `).all(thirtyAgo.toISOString().slice(0, 10));

  const streakMap = {};
  streakRows.forEach(r => {
    if (!streakMap[r.user_id]) streakMap[r.user_id] = {};
    streakMap[r.user_id][r.date] = r.done;
  });

  function calcStreak(userId) {
    let streak = 0;
    for (let i = 0; i <= 30; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const done = (streakMap[userId] || {})[ds] || 0;
      const pct  = Math.round((done / totalHabits) * 100);
      if (pct >= 70) streak++;
      else if (i > 0) break;
    }
    return streak;
  }

  // Top 20 + current user always included
  const top20 = ranked.slice(0, 20).map(u => ({
    rank:        u.rank,
    displayName: u.displayName,
    weekPct:     u.weekPct,
    activeDays:  u.activeDays,
    streak:      calcStreak(u.id),
    isMe:        u.isMe,
  }));

  // Ensure current user is in list
  if (me && !top20.find(u => u.isMe)) {
    top20.push({
      rank:        me.rank,
      displayName: me.displayName,
      weekPct:     me.weekPct,
      activeDays:  me.activeDays,
      streak:      calcStreak(req.user.id),
      isMe:        true,
    });
  }

  // Platform-wide stats (no PII)
  const platformStats = db.prepare(`
    SELECT
      COUNT(DISTINCT user_id) as total_users,
      ROUND(AVG(done_count) * 100.0 / ?, 1) as avg_weekly_pct
    FROM (
      SELECT user_id, COUNT(CASE WHEN completed=1 THEN 1 END) as done_count
      FROM habits WHERE date BETWEEN ? AND ?
      GROUP BY user_id
    )
  `).get(maxPossible, weekStart, weekEnd);

  res.json({
    weekRange: { start: weekStart, end: weekEnd },
    myRank, myDisplayName: me ? me.displayName : null,
    totalUsers: total,
    betterThan,
    platformAvgPct: platformStats ? platformStats.avg_weekly_pct || 0 : 0,
    leaderboard: top20,
  });
});

// ── STATS API (own detailed stats) ────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const totalHabits = 23;
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const from = thirtyAgo.toISOString().slice(0, 10);

  const daily = db.prepare(`
    SELECT date, COUNT(CASE WHEN completed=1 THEN 1 END) as done
    FROM habits WHERE user_id = ? AND date >= ?
    GROUP BY date ORDER BY date
  `).all(req.user.id, from);

  const totalDone = db.prepare(
    `SELECT COUNT(*) as c FROM habits WHERE user_id = ? AND completed = 1`
  ).get(req.user.id).c;

  const wt = db.prepare(
    `SELECT MIN(weight_kg) as min_w, MAX(weight_kg) as max_w FROM weights WHERE user_id = ?`
  ).get(req.user.id);

  res.json({ daily: daily.map(r => ({ date: r.date, pct: Math.round(r.done / totalHabits * 100) })), totalDone, wt });
});

// ── PROFILE ───────────────────────────────────────────────────────────────────

app.get('/api/profile', auth, (req, res) => {
  const row = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(req.user.id);
  if (!row) return res.json(null);
  res.json({
    dietType:    row.diet_type,
    proteins:    JSON.parse(row.proteins),
    veggies:     JSON.parse(row.veggies),
    carbs:       JSON.parse(row.carbs),
    mealVariety: row.meal_variety || 'same',
  });
});

app.post('/api/profile', auth, (req, res) => {
  const { dietType, proteins, veggies, carbs, mealVariety } = req.body;
  if (!dietType) return res.status(400).json({ error: 'dietType required' });
  db.prepare(`
    INSERT INTO profiles (user_id, diet_type, proteins, veggies, carbs, meal_variety, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      diet_type    = excluded.diet_type,
      proteins     = excluded.proteins,
      veggies      = excluded.veggies,
      carbs        = excluded.carbs,
      meal_variety = excluded.meal_variety,
      updated_at   = datetime('now')
  `).run(req.user.id, dietType,
    JSON.stringify(proteins || []),
    JSON.stringify(veggies  || []),
    JSON.stringify(carbs    || []),
    mealVariety || 'same');
  res.json({ ok: true });
});

// ── CATCH-ALL ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Daily Reset  →  http://localhost:${PORT}`);
  if (DEV_MODE || !process.env.SMTP_USER) {
    console.log(`  DEV MODE: OTPs will print to console (copy .env.example → .env to set up email)\n`);
  }
});
