import { initDb } from '../../lib/initDb.js'
import pool from '../../lib/db.js'
import { getUser } from '../../lib/auth.js'

let dbReady = false

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!dbReady) { await initDb(); dbReady = true }

  const user = getUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })

  const { date, weight } = req.body
  if (!date || !weight) return res.status(400).json({ error: 'date and weight required' })

  await pool.query(
    `INSERT INTO weights (user_id, date, weight_kg) VALUES ($1, $2, $3)
     ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`,
    [user.id, date, weight]
  )
  return res.json({ ok: true })
}
