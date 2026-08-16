import fs from 'fs'
import path from 'path'

export async function getServerSideProps({ res }) {
  const html = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf8')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(html)
  return { props: {} }
}

export default function Page() {
  return null
}
