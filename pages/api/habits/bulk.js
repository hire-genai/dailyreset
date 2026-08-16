import { initDb } from '../../../lib/initDb.js'
import pool from '../../../lib/db.js'
import { getUser } from '../../../lib/auth.js'

let dbReady = false

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!dbReady) { await initDb(); dbReady = true }

  const user = getUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })

  const { data } = req.body
  if (!data) return res.status(400).json({ error: 'data required' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const [date, habits] of Object.entries(data)) {
      for (const [habitId, completed] of Object.entries(habits)) {
        await client.query(
          `INSERT INTO habits (user_id, date, habit_id, completed) VALUES ($1, $2, $3, $4)
           ON CONFLICT(user_id, date, habit_id) DO UPDATE SET completed = EXCLUDED.completed`,
          [user.id, date, habitId, completed ? 1 : 0]
        )
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return res.json({ ok: true })
}
