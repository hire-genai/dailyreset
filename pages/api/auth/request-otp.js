import { initDb } from '../../../lib/initDb.js'
import pool from '../../../lib/db.js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'

let dbReady = false

function makeOtp() {
  return String(crypto.randomInt(100000, 1000000))
}

function getTransporter() {
  const DEV_MODE = process.env.DEV_MODE === 'true'
  if (DEV_MODE || !process.env.SMTP_USER) return null
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

async function sendOtpEmail(email, code) {
  const DEV_MODE = process.env.DEV_MODE === 'true'
  const transporter = getTransporter()
  if (DEV_MODE || !transporter) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`  OTP for ${email}: ${code}`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
    return
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `"Daily Reset" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Your Daily Reset login code: ${code}`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;background:#0f1117;color:#e2e8f0;padding:32px;border-radius:12px">
        <h2 style="color:#6c63ff;margin:0 0 8px">Daily Reset</h2>
        <p style="color:#8892b0;margin:0 0 24px;font-size:14px">Your one-time login code</p>
        <div style="background:#22263a;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px">
          <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#6c63ff">${code}</span>
        </div>
        <p style="color:#8892b0;font-size:13px">This code expires in 10 minutes. Never share it with anyone.</p>
      </div>`,
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!dbReady) { await initDb(); dbReady = true }

  const email = (req.body.email || '').toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }

  // Rate limit: max 3 OTPs per email per 15 minutes
  const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { rows: rateRows } = await pool.query(
    `SELECT COUNT(*) as c FROM otp_codes WHERE email = $1 AND expires_at > $2`,
    [email, fifteenAgo]
  )
  if (parseInt(rateRows[0].c) >= 3) {
    return res.status(429).json({ error: 'Too many requests. Wait 15 minutes.' })
  }

  const code    = makeOtp()
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await pool.query(
    `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
    [email, code, expires]
  )

  const DEV_MODE = process.env.DEV_MODE === 'true'
  try {
    await sendOtpEmail(email, code)
    res.json({ ok: true, dev: DEV_MODE || !process.env.SMTP_USER })
  } catch (err) {
    console.error('Email error:', err.message)
    res.status(500).json({ error: 'Failed to send email. Check SMTP config in .env' })
  }
}
