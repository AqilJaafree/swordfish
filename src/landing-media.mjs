import { readFile } from 'node:fs/promises'

// Explicit names keep this public-media endpoint separate from application data. Only the original
// hero render is served; the archived third-party reference files (see SOURCES.md) are not.
const media = new Map([
  ['hero.mp4', 'video/mp4'],
  ['hero-poster.jpg', 'image/jpeg'],
])

export async function landingMedia(name, range) {
  const type = media.get(name)
  if (!type) return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' }
  const content = await readFile(new URL(`../public/landing-media/${name}`, import.meta.url))
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600' }
  // Native video players request byte ranges for metadata and playback seeks.
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    let start = 0, end = content.length - 1
    if (!match || (!match[1] && !match[2])) return invalidRange()
    if (!match[1]) start = Math.max(0, content.length - Number(match[2]))
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= content.length) return invalidRange()
    return {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${content.length}`, 'content-length': end - start + 1 },
      body: content.subarray(start, end + 1),
    }
  }
  return { status: 200, headers: { ...headers, 'content-length': content.length }, body: content }
  function invalidRange() {
    return { status: 416, headers: { ...headers, 'content-range': `bytes */${content.length}` }, body: '' }
  }
}
