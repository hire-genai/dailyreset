import { initDb } from '../../lib/initDb.js'
import pool from '../../lib/db.js'
import { getUser } from '../../lib/auth.js'

let dbReady = false

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (!dbReady) { await initDb(); dbReady = true }

  const user = getUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })

  const totalHabits = 23
  const thirtyAgo = new Date()
  thirtyAgo.setDate(thirtyAgo.getDate() - 30)
  const from = thirtyAgo.toISOString().slice(0, 10)

  const { rows: daily } = await pool.query(
    `SELECT date, COUNT(CASE WHEN completed=1 THEN 1 END) as done
     FROM habits WHERE user_id = $1 AND date >= $2
     GROUP BY date ORDER BY date`,
    [user.id, from]
  )

  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) as c FROM habits WHERE user_id = $1 AND completed = 1`,
    [user.id]
  )
  const totalDone = parseInt(totalRows[0].c)

  const { rows: wtRows } = await pool.query(
    `SELECT MIN(weight_kg) as min_w, MAX(weight_kg) as max_w FROM weights WHERE user_id = $1`,
    [user.id]
  )
  const wt = wtRows[0]

  return res.json({
    daily: daily.map(r => ({ date: r.date, pct: Math.round(parseInt(r.done) / totalHabits * 100) })),
    totalDone,
    wt,
  })
}
