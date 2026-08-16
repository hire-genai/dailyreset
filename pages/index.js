import fs from 'fs'
import path from 'path'

export async function getServerSideProps({ res }) {
  try {
    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.write(html)
    res.end()
  } catch (e) {
    res.statusCode = 500
    res.end('Error loading app')
  }
  return { props: {} }
}

export default function Page() {
  return null
}
