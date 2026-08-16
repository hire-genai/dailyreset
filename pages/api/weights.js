import { initDb } from '../../lib/initDb.js'
import pool from '../../lib/db.js'
import { getUser } from '../../lib/auth.js'

let dbReady = false

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (!dbReady) { await initDb(); dbReady = true }

  const user = getUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })

  const { rows } = await pool.query(
    `SELECT date, weight_kg FROM weights WHERE user_id = $1 ORDER BY date DESC LIMIT 90`,
    [user.id]
  )
  return res.json(rows)
}
