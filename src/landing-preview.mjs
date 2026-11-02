// Standalone landing preview. App links lead to the existing dashboard server.
// No wallet, bot, database, or environment-file initialization is needed.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { landingMedia } from './landing-media.mjs'

const port = Number(process.env.LANDING_PORT || 8788)
const appUrl = new URL(process.env.LANDING_APP_URL || 'http://localhost:8787/')
const files = {
  '/landing': ['landing.html', 'text/html'],
  '/landing/': ['landing.html', 'text/html'],
  '/landing.html': ['landing.html', 'text/html'],
  '/landing.css': ['landing.css', 'text/css'],
  '/landing.js': ['landing.js', 'text/javascript'],
}
createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost')
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { allow: 'GET, HEAD' }); return res.end()
  }
  if (pathname === '/' || pathname === '/app') {
    res.writeHead(302, { location: new URL('/app', appUrl).href }); return res.end()
  }
  if (pathname.startsWith('/landing-media/')) {
    try {
      const result = await landingMedia(pathname.slice('/landing-media/'.length), req.headers.range)
      res.writeHead(result.status, result.headers)
      return res.end(req.method === 'HEAD' ? undefined : result.body)
    } catch {
      res.writeHead(500); return res.end('Unable to load media')
    }
  }
  const file = files[pathname]
  if (!file) { res.writeHead(404); return res.end('Not found') }
  try {
    const content = await readFile(new URL(`../public/${file[0]}`, import.meta.url))
    res.writeHead(200, { 'content-type': `${file[1]}; charset=utf-8`, 'cache-control': 'no-cache' })
    res.end(req.method === 'HEAD' ? undefined : content)
  } catch {
    res.writeHead(500); res.end('Unable to load landing page asset')
  }
}).listen(port, '127.0.0.1', () => console.log(`Swordfish landing preview: http://localhost:${port}/landing`))
