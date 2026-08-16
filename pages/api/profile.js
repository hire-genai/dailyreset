import { initDb } from '../../lib/initDb.js'
import pool from '../../lib/db.js'
import { getUser } from '../../lib/auth.js'

let dbReady = false

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!dbReady) { await initDb(); dbReady = true }

  const user = getUser(req)
  if (!user) return res.status(401).json({ error: 'Not authenticated' })

  if (req.method === 'GET') {
    const { rows } = await pool.query(
      `SELECT * FROM profiles WHERE user_id = $1`,
      [user.id]
    )
    if (!rows[0]) return res.json(null)
    const row = rows[0]
    return res.json({
      dietType:    row.diet_type,
      proteins:    JSON.parse(row.proteins),
      veggies:     JSON.parse(row.veggies),
      carbs:       JSON.parse(row.carbs),
      mealVariety: row.meal_variety || 'same',
    })
  }

  // POST
  const { dietType, proteins, veggies, carbs, mealVariety } = req.body
  if (!dietType) return res.status(400).json({ error: 'dietType required' })

  await pool.query(
    `INSERT INTO profiles (user_id, diet_type, proteins, veggies, carbs, meal_variety, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT(user_id) DO UPDATE SET
       diet_type    = EXCLUDED.diet_type,
       proteins     = EXCLUDED.proteins,
       veggies      = EXCLUDED.veggies,
       carbs        = EXCLUDED.carbs,
       meal_variety = EXCLUDED.meal_variety,
       updated_at   = NOW()`,
    [
      user.id,
      dietType,
      JSON.stringify(proteins || []),
      JSON.stringify(veggies  || []),
      JSON.stringify(carbs    || []),
      mealVariety || 'same',
    ]
  )
  return res.json({ ok: true })
}
