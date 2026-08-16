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
  if (DEV_MODE || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

async function sendOtpEmail(email, code) {
  const DEV_MODE = process.env.DEV_MODE === 'true'
  const transporter = getTransporter()
  if (DEV_MODE || !transporter) {
    console.log(`[OTP] DEV_MODE — code for ${email}: ${code}`)
    return { sent: false }
  }
  const info = await transporter.sendMail({
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
  const ok = info.accepted?.includes(email)
  console.log(`[OTP] Email to ${email}: ${ok ? '✓ SENT' : '✗ FAILED'} (${info.response})`)
  return { sent: ok }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!dbReady) { await initDb(); dbReady = true }

  const email = (req.body.email || '').toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' })
  }

  const code    = makeOtp()
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await pool.query(
    `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
    [email, code, expires]
  )

  const DEV_MODE = process.env.DEV_MODE === 'true'
  try {
    const result = await sendOtpEmail(email, code)
    res.json({ ok: true, dev: DEV_MODE || !process.env.SMTP_USER, sent: result.sent })
  } catch (err) {
    console.error(`[OTP] ✗ Failed for ${email}:`, err.message)
    res.status(500).json({ error: 'Failed to send email: ' + err.message })
  }
}
