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

  // Week range (last 7 days)
  const dates = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }
  const weekStart = dates[0], weekEnd = dates[6]

  // Per-user weekly completion
  const { rows: userStats } = await pool.query(
    `SELECT
       u.id,
       u.display_name,
       COUNT(CASE WHEN h.completed = 1 THEN 1 END) as done_count,
       COUNT(DISTINCT CASE WHEN h.completed = 1 THEN h.date END) as active_days
     FROM users u
     LEFT JOIN habits h ON h.user_id = u.id AND h.date BETWEEN $1 AND $2
     GROUP BY u.id`,
    [weekStart, weekEnd]
  )

  const maxPossible = totalHabits * 7

  const ranked = userStats
    .map(u => ({
      id:          u.id,
      displayName: u.display_name,
      weekPct:     Math.round((parseInt(u.done_count) / maxPossible) * 100),
      activeDays:  parseInt(u.active_days),
      isMe:        u.id === user.id,
    }))
    .sort((a, b) => b.weekPct - a.weekPct)

  // Assign ranks
  let rank = 0, prev = -1
  ranked.forEach((u, i) => {
    if (u.weekPct !== prev) { rank = i + 1; prev = u.weekPct }
    u.rank = rank
  })

  const total  = ranked.length
  const me     = ranked.find(u => u.isMe)
  const myRank = me ? me.rank : null
  const betterThan = me ? Math.round(((total - myRank) / Math.max(total - 1, 1)) * 100) : 0

  // Streaks per user (last 30 days)
  const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30)
  const { rows: streakRows } = await pool.query(
    `SELECT user_id, date, COUNT(CASE WHEN completed=1 THEN 1 END) as done
     FROM habits
     WHERE date >= $1
     GROUP BY user_id, date`,
    [thirtyAgo.toISOString().slice(0, 10)]
  )

  const streakMap = {}
  streakRows.forEach(r => {
    if (!streakMap[r.user_id]) streakMap[r.user_id] = {}
    streakMap[r.user_id][r.date] = parseInt(r.done)
  })

  function calcStreak(userId) {
    let streak = 0
    for (let i = 0; i <= 30; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const ds   = d.toISOString().slice(0, 10)
      const done = (streakMap[userId] || {})[ds] || 0
      const pct  = Math.round((done / totalHabits) * 100)
      if (pct >= 70) streak++
      else if (i > 0) break
    }
    return streak
  }

  // Top 20 + current user always included
  const top20 = ranked.slice(0, 20).map(u => ({
    rank:        u.rank,
    displayName: u.displayName,
    weekPct:     u.weekPct,
    activeDays:  u.activeDays,
    streak:      calcStreak(u.id),
    isMe:        u.isMe,
  }))

  if (me && !top20.find(u => u.isMe)) {
    top20.push({
      rank:        me.rank,
      displayName: me.displayName,
      weekPct:     me.weekPct,
      activeDays:  me.activeDays,
      streak:      calcStreak(user.id),
      isMe:        true,
    })
  }

  // Platform-wide stats (no PII)
  const { rows: platformRows } = await pool.query(
    `SELECT
       COUNT(DISTINCT user_id) as total_users,
       ROUND(AVG(done_count) * 100.0 / $1, 1) as avg_weekly_pct
     FROM (
       SELECT user_id, COUNT(CASE WHEN completed=1 THEN 1 END) as done_count
       FROM habits WHERE date BETWEEN $2 AND $3
       GROUP BY user_id
     ) sub`,
    [maxPossible, weekStart, weekEnd]
  )
  const platformStats = platformRows[0]

  return res.json({
    weekRange: { start: weekStart, end: weekEnd },
    myRank,
    myDisplayName: me ? me.displayName : null,
    totalUsers: total,
    betterThan,
    platformAvgPct: platformStats ? parseFloat(platformStats.avg_weekly_pct) || 0 : 0,
    leaderboard: top20,
  })
}
