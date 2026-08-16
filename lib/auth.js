import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'

const ANIMAL_ADJ  = ['Bold','Swift','Strong','Brave','Calm','Lean','Fit','Sharp','Cool','Bright']
const ANIMAL_NOUN = ['Tiger','Eagle','Wolf','Bear','Fox','Lion','Hawk','Panda','Deer','Crane']

export function anonymousName(userId) {
  const a = ANIMAL_ADJ[userId % ANIMAL_ADJ.length]
  const n = ANIMAL_NOUN[Math.floor(userId / ANIMAL_ADJ.length) % ANIMAL_NOUN.length]
  return `${a}${n}`
}

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' })
}

export function getUser(req) {
  const header = req.headers.authorization || ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}
