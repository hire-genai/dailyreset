import { initDb } from '../../../lib/initDb.js'
import pool from '../../../lib/db.js'
import { getUser } from '../../../lib/auth.js'

let dbReady = false

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!dbReady) { await initDb(); dbReady = true }

  const user = getUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })

  if (req.method === 'GET') {
    const { from, to } = req.query
    let rows
    if (from && to) {
      const { rows: r } = await pool.query(
        `SELECT date, habit_id, completed FROM habits WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
        [user.id, from, to]
      )
      rows = r
    } else {
      const { rows: r } = await pool.query(
        `SELECT date, habit_id, completed FROM habits WHERE user_id = $1 ORDER BY date DESC LIMIT 500`,
        [user.id]
      )
      rows = r
    }
    // Group by date
    const result = {}
    rows.forEach(r => {
      if (!result[r.date]) result[r.date] = {}
      result[r.date][r.habit_id] = !!r.completed
    })
    return res.json(result)
  }

  // POST
  const { date, habitId, completed } = req.body
  if (!date || !habitId) return res.status(400).json({ error: 'date and habitId required' })
  await pool.query(
    `INSERT INTO habits (user_id, date, habit_id, completed) VALUES ($1, $2, $3, $4)
     ON CONFLICT(user_id, date, habit_id) DO UPDATE SET completed = EXCLUDED.completed`,
    [user.id, date, habitId, completed ? 1 : 0]
  )
  return res.json({ ok: true })
}
