import { initDb } from '../../lib/initDb.js'
import pool from '../../lib/db.js'
import { getUser } from '../../lib/auth.js'

let dbReady = false

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!dbReady) { await initDb(); dbReady = true }

  const user = getUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })

  if (req.method === 'GET') {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, name, phone, created_at FROM users WHERE id = $1`,
      [user.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'User not found' })
    const u = rows[0]
    return res.json({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      name: u.name,
      phone: u.phone,
      createdAt: u.created_at,
    })
  }

  // PATCH
  const name  = (req.body.name  || '').trim() || null
  const phone = (req.body.phone || '').trim() || null
  await pool.query(`UPDATE users SET name = $1, phone = $2 WHERE id = $3`, [name, phone, user.id])
  return res.json({ ok: true })
}
