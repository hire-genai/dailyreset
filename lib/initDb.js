import pool from './db.js'

let initialized = false

export async function initDb() {
  if (initialized) return
  initialized = true

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      email        TEXT UNIQUE NOT NULL,
      display_name TEXT,
      name         TEXT,
      phone        TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id         SERIAL PRIMARY KEY,
      email      TEXT NOT NULL,
      code       TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used       INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS habits (
      id        SERIAL PRIMARY KEY,
      user_id   INTEGER NOT NULL,
      date      TEXT NOT NULL,
      habit_id  TEXT NOT NULL,
      completed INTEGER DEFAULT 1,
      UNIQUE(user_id, date, habit_id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS weights (
      id        SERIAL PRIMARY KEY,
      user_id   INTEGER NOT NULL,
      date      TEXT NOT NULL,
      weight_kg REAL NOT NULL,
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
      updated_at   TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `)
}
