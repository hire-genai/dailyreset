import { initDb } from '../../../lib/initDb.js'
import pool from '../../../lib/db.js'
import { anonymousName, signToken } from '../../../lib/auth.js'

let dbReady = false

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!dbReady) { await initDb(); dbReady = true }

  const email = (req.body.email || '').toLowerCase().trim()
  const code  = (req.body.code  || '').trim()
  const now   = new Date().toISOString()

  const { rows } = await pool.query(
    `SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND used = 0 AND expires_at > $3 ORDER BY id DESC LIMIT 1`,
    [email, code, now]
  )
  const row = rows[0]
  if (!row) return res.status(401).json({ error: 'Invalid or expired code' })

  // Mark used
  await pool.query(`UPDATE otp_codes SET used = 1 WHERE id = $1`, [row.id])

  // Upsert user
  let isNewUser = false
  const { rows: existingUsers } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email])
  let user = existingUsers[0]

  if (!user) {
    isNewUser = true
    const { rows: inserted } = await pool.query(
      `INSERT INTO users (email) VALUES ($1) RETURNING id`,
      [email]
    )
    const newId = inserted[0].id
    const displayName = anonymousName(newId)
    await pool.query(`UPDATE users SET display_name = $1 WHERE id = $2`, [displayName, newId])
    const { rows: newUsers } = await pool.query(`SELECT * FROM users WHERE id = $1`, [newId])
    user = newUsers[0]
  }

  const token = signToken(user)
  res.json({
    token,
    isNewUser,
    user: { id: user.id, displayName: user.display_name, email: user.email },
  })
}
