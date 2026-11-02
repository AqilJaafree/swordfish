const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let paused = reducedMotion.matches
const motionControls = [...document.querySelectorAll('[data-motion]')]
let heroMotion
let sectionMotion
function setMotion(value) {
  paused = value
  document.documentElement.classList.toggle('motion-paused', paused)
  for (const button of motionControls) {
    button.setAttribute('aria-pressed', String(paused))
    button.setAttribute('aria-label', paused ? 'Resume animations' : 'Pause animations')
    const symbol = button.querySelector('.motion-symbol')
    if (symbol) symbol.textContent = paused ? '▷' : 'Ⅱ'
    else button.textContent = paused ? 'Resume animations ▷' : 'Pause animations Ⅱ'
  }
  heroMotion?.setPaused(paused)
  sectionMotion?.setPaused(paused)
  updateScroll()
}
motionControls.forEach((button) => button.addEventListener('click', () => setMotion(!paused)))
reducedMotion.addEventListener('change', ({ matches }) => setMotion(matches))
document.querySelector('#year').textContent = new Date().getFullYear()

const menuButton = document.querySelector('.menu-toggle')
const mobileNav = document.querySelector('#mobile-nav')
function closeMenu() {
  mobileNav.hidden = true
  menuButton.setAttribute('aria-expanded', 'false')
  menuButton.setAttribute('aria-label', 'Open navigation')
}
menuButton.addEventListener('click', () => {
  const opening = mobileNav.hidden
  mobileNav.hidden = !opening
  menuButton.setAttribute('aria-expanded', String(opening))
  menuButton.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation')
})
mobileNav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !mobileNav.hidden) { closeMenu(); menuButton.focus() }
})
matchMedia('(min-width: 761px)').addEventListener('change', ({ matches }) => { if (matches) closeMenu() })

const header = document.querySelector('#site-header')
const heroTrack = document.querySelector('.hero-track')
const hero = document.querySelector('.hero')
const stack = document.querySelector('.stack-section')
const stackSteps = [...document.querySelectorAll('[data-step]')]
const chambers = [...document.querySelectorAll('[data-chamber]')]
const opportunity = document.querySelector('.opportunity-details')
const lightSections = [...document.querySelectorAll('.light-section')]
const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x))
let currentStep = -1
function selectStep(index) {
  if (index === currentStep) return
  currentStep = index
  stackSteps.forEach((step, i) => {
    step.classList.toggle('active', i === index)
    step.setAttribute('aria-pressed', String(i === index))
  })
  chambers.forEach((chamber, i) => chamber.classList.toggle('active', i === index))
}
stackSteps.forEach((step, index) => step.addEventListener('click', () => selectStep(index)))
let queued = false
function updateScroll() {
  queued = false
  const heroBounds = heroTrack.getBoundingClientRect()
  const heroExit = clamp(-heroBounds.top / Math.max(1, heroBounds.height - innerHeight))
  const stackBounds = stack.getBoundingClientRect()
  const headerProbe = header.getBoundingClientRect().bottom + 12
  const light = lightSections.some((section) => {
    const rect = section.getBoundingClientRect()
    return rect.top <= headerProbe && rect.bottom > headerProbe
  }) || (stackBounds.top < headerProbe && stackBounds.top > -stackBounds.height * .4)
  let nextStep = currentStep
  if (stackBounds.top < innerHeight && stackBounds.bottom > 0) {
    const focusLine = innerHeight * .43
    let nearest = 0, distance = Infinity
    stackSteps.forEach((step, index) => {
      const rect = step.getBoundingClientRect()
      const current = Math.abs(rect.top + rect.height * .3 - focusLine)
      if (current < distance) { nearest = index; distance = current }
    })
    nextStep = nearest
  }
  const opportunityBounds = opportunity.getBoundingClientRect()
  const opportunityProgress = clamp((innerHeight - opportunityBounds.top) / (innerHeight + opportunityBounds.height))
  // Read geometry first, then write styles together to avoid repeated layout work.
  hero.style.setProperty('--hero-scale', String(paused ? 1 : 1 - heroExit * .025))
  header.classList.toggle('scrolled', scrollY > 35)
  header.classList.toggle('light', light)
  if (nextStep >= 0) selectStep(nextStep)
  opportunity.style.setProperty('--opportunity-drift', `${paused ? 0 : (opportunityProgress - .5) * -65}px`)
}
function requestScroll() { if (!queued) { queued = true; requestAnimationFrame(updateScroll) } }
addEventListener('scroll', requestScroll, { passive: true })
addEventListener('resize', requestScroll, { passive: true })
heroMotion = createMetalFilm()
sectionMotion = createSectionMotion()
setMotion(paused)
selectStep(0)

// Signal panel: each tab renders an illustrative chart from a seeded series with
// real indicator maths (SMA, RSI, MACD), so markers land where the signal fires.
const signals = {
  sma: { kicker: 'Moving average crossover', code: 'SMA / 01', title: ['A clearer view', 'of momentum.'], description: 'Watch the signal. Test the thesis.' },
  rsi: { kicker: 'Relative strength index', code: 'RSI / 02', title: ['A perspective', 'on the extremes.'], description: 'Look for stretched momentum.' },
  macd: { kicker: 'Moving average convergence', code: 'MACD / 03', title: ['Follow a shift', 'in direction.'], description: 'See momentum take a new shape.' },
}
const SG = { w: 600, left: 10, right: 534, axis: 594 }
function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 }
function candles(n, shape, seed, vol) {
  const rnd = seeded(seed), out = []
  let close = shape(0)
  for (let i = 0; i < n; i++) {
    const open = close
    close = shape(i / (n - 1)) + (rnd() - 0.5) * vol
    out.push({ open, close, high: Math.max(open, close) + rnd() * vol * 0.6, low: Math.min(open, close) - rnd() * vol * 0.6, volume: 0.35 + rnd() * 0.65 })
  }
  return out
}
const smaOf = (xs, p) => xs.map((_, i) => (i < p - 1 ? null : xs.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p))
function emaOf(xs, p) { const k = 2 / (p + 1); let e = xs[0]; return xs.map((x) => (e = x * k + e * (1 - k))) }
function rsiOf(xs, p = 14) {
  let gain = 0, loss = 0
  return xs.map((x, i) => {
    if (i === 0) return null
    const d = x - xs[i - 1]
    gain = (gain * (p - 1) + Math.max(d, 0)) / p
    loss = (loss * (p - 1) + Math.max(-d, 0)) / p
    return i < p ? null : 100 - 100 / (1 + gain / (loss || 1e-9))
  })
}
const fx = (n) => Math.round(n * 10) / 10
function line(values, x, y) {
  let d = ''
  values.forEach((v, i) => { if (v != null) d += `${d ? 'L' : 'M'}${fx(x(i))} ${y(v)}` })
  return d
}
function crossings(a, b, from = 0) {
  const out = []
  for (let i = Math.max(1, from); i < a.length; i++) {
    if ([a[i], b[i], a[i - 1], b[i - 1]].includes(null)) continue
    if (a[i - 1] <= b[i - 1] && a[i] > b[i]) out.push({ i, up: true })
    if (a[i - 1] >= b[i - 1] && a[i] < b[i]) out.push({ i, up: false })
  }
  return out
}
const tag = (x, y, text, cls = '') => {
  const w = text.length * 6.6 + 16, tx = Math.min(Math.max(x - w / 2, SG.left), SG.right - w)
  return `<g class="sg-tag ${cls}" transform="translate(${fx(tx)} ${fx(y)})"><rect width="${fx(w)}" height="19" rx="5"/><text x="8" y="13">${text}</text></g>`
}
const marker = (x, y, cls, delay, label, labelY) => `<g class="sg-mk" style="--d:${delay}s"><circle class="sg-halo ${cls}" cx="${fx(x)}" cy="${fx(y)}" r="9"/><circle class="sg-dot ${cls}" cx="${fx(x)}" cy="${fx(y)}" r="4.5"/>${label ? tag(x, labelY, label, cls) : ''}</g>`
function grid(top, bottom, rows, y, fmt, avoid = -99) {
  let g = ''
  for (let r = 0; r <= rows; r++) {
    const yy = fx(top + ((bottom - top) * r) / rows)
    g += `<path class="sg-grid" d="M${SG.left} ${yy}H${SG.right}"/>`
    if (fmt && Math.abs(yy - avoid) > 14) g += `<text class="sg-ax" x="${SG.axis}" y="${fx(yy + 4)}" text-anchor="end">${fmt(yy)}</text>`
  }
  return g
}
function lastTag(y, value) {
  return `<g class="sg-last"><path class="sg-lastline" d="M${SG.left} ${y}H${SG.right}"/><rect x="${SG.right + 6}" y="${fx(y - 10)}" width="56" height="20" rx="5"/><text x="${SG.right + 34}" y="${fx(y + 4)}" text-anchor="middle">${value}</text></g>`
}
const times = (bottom) => ['09:00', '12:00', '15:00', '18:00', '21:00'].map((t, i) => `<text class="sg-ax" x="${fx(SG.left + ((SG.right - SG.left) * i) / 4)}" y="${bottom}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${t}</text>`).join('')
function invertible(values, top, bottom) { const v = values.filter((x) => x != null), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo, pad = span * 0.06; const y = (x) => fx(bottom - ((x - lo + pad) / (span + pad * 2)) * (bottom - top)); y.inv = (yy) => lo - pad + ((bottom - yy) / (bottom - top)) * (span + pad * 2); return y }

const charts = {
  sma() {
    const warm = 20, n = 46
    const all = candles(n + warm, (t) => 2240 + 34 * Math.sin(t * 5.2 + 0.7) * (1 - t) - 36 * t + 160 * Math.max(0, t - 0.62) ** 1.4, 7, 14)
    const closes = all.map((c) => c.close), fast = smaOf(closes, 7).slice(warm), slow = smaOf(closes, 20).slice(warm), bars = all.slice(warm)
    const x = (i) => SG.left + 6 + (i * (SG.right - SG.left - 12)) / (n - 1), bw = ((SG.right - SG.left) / n) * 0.56
    const y = invertible([...bars.flatMap((b) => [b.high, b.low]), ...fast, ...slow], 18, 232)
    let body = grid(18, 232, 4, y, (yy) => Math.round(y.inv(yy)).toLocaleString('en-US'), y(bars[n - 1].close))
    body += '<g class="sg-plot">'
    bars.forEach((b, i) => { const up = b.close >= b.open, cls = up ? 'up' : 'down'; body += `<path class="sg-wick ${cls}" d="M${fx(x(i))} ${y(b.high)}V${y(b.low)}"/><rect class="sg-body ${cls}" x="${fx(x(i) - bw / 2)}" y="${Math.min(y(b.open), y(b.close))}" width="${fx(bw)}" height="${Math.max(1.2, fx(Math.abs(y(b.open) - y(b.close))))}" rx="1"/><rect class="sg-vol ${cls}" x="${fx(x(i) - bw / 2)}" y="${fx(300 - b.volume * 44)}" width="${fx(bw)}" height="${fx(b.volume * 44)}" rx="1"/>` })
    body += `<path class="sg-slow" d="${line(slow, x, y)}"/><path class="sg-fast" d="${line(fast, x, y)}"/></g>`
    const xs = crossings(fast, slow, 1), golden = xs.filter((c) => c.up).pop(), death = xs.filter((c) => !c.up && (!golden || c.i < golden.i)).pop()
    if (death) body += marker(x(death.i), y(slow[death.i]), 'sell', 1.5, 'DEATH CROSS', y(slow[death.i]) - 34)
    if (golden) body += marker(x(golden.i), y(slow[golden.i]), 'buy', 1.8, 'GOLDEN CROSS · BUY', y(slow[golden.i]) + 16)
    const last = bars[n - 1].close
    body += lastTag(y(last), Math.round(last).toLocaleString('en-US')) + `<g class="sg-live"><circle class="sg-ring" cx="${fx(x(n - 1))}" cy="${y(last)}" r="5"/><circle cx="${fx(x(n - 1))}" cy="${y(last)}" r="3"/></g>`
    body += `<g class="sg-key" transform="translate(${SG.left} 318)"><path class="sg-fast" d="M0 0h14"/><text x="20" y="4">SMA 7</text><path class="sg-slow" d="M76 0h14"/><text x="96" y="4">SMA 20</text><text x="170" y="4" class="sg-dimtxt">VOL</text></g>`
    return body + times(338).replace(/class="sg-ax"/g, 'class="sg-ax sg-time"')
  },
  rsi() {
    const warm = 16, n = 64
    const all = candles(n + warm, (t) => 2250 + 40 * Math.sin(t * 13.5) + 12 * Math.sin(t * 31), 11, 9)
    const closes = all.map((c) => c.close), rsi = rsiOf(closes).slice(warm), px = closes.slice(warm)
    const x = (i) => SG.left + (i * (SG.right - SG.left)) / (n - 1)
    const y = invertible(px, 18, 160), r = (v) => fx(296 - (v / 100) * (296 - 196))
    let body = grid(18, 160, 3, y, (yy) => Math.round(y.inv(yy)).toLocaleString('en-US'), y(px[n - 1]))
    body += `<rect class="sg-zone hot" x="${SG.left}" y="${r(100)}" width="${SG.right - SG.left}" height="${fx(r(70) - r(100))}"/><rect class="sg-zone cold" x="${SG.left}" y="${r(30)}" width="${SG.right - SG.left}" height="${fx(r(0) - r(30))}"/>`
    body += `<path class="sg-level" d="M${SG.left} ${r(70)}H${SG.right}M${SG.left} ${r(30)}H${SG.right}"/><path class="sg-grid" d="M${SG.left} ${r(50)}H${SG.right}"/>`
    body += [70, 50, 30].map((v) => `<text class="sg-ax" x="${SG.axis}" y="${fx(r(v) + 4)}" text-anchor="end">${v}</text>`).join('')
    body += `<text class="sg-ax sg-dimtxt" x="${SG.left}" y="188">RSI 14</text>`
    const area = line(px, x, y)
    body += `<g class="sg-plot"><path class="sg-area" d="${area}L${fx(x(n - 1))} 160L${SG.left} 160Z"/><path class="sg-price" d="${area}"/><path class="sg-rsi" d="${line(rsi, x, r)}"/></g>`
    const events = []
    for (let i = 1; i < n; i++) {
      if (rsi[i - 1] != null && rsi[i - 1] < 30 && rsi[i] >= 30) events.push({ i: i - 1, buy: true })
      if (rsi[i - 1] != null && rsi[i - 1] > 70 && rsi[i] <= 70) events.push({ i: i - 1, buy: false })
    }
    events.slice(0, 5).forEach((e, k) => {
      const cls = e.buy ? 'buy' : 'sell', d = 1.3 + k * 0.25
      body += `<path class="sg-guide ${cls} sg-mk" style="--d:${d}s" d="M${fx(x(e.i))} ${y(px[e.i])}V${r(rsi[e.i])}"/>`
      body += marker(x(e.i), y(px[e.i]), cls, d, k < 2 ? (e.buy ? 'BUY · OVERSOLD' : 'SELL · OVERBOUGHT') : '', e.buy ? y(px[e.i]) + 14 : y(px[e.i]) - 32)
      body += marker(x(e.i), r(rsi[e.i]), cls, d + 0.1)
    })
    const last = px[n - 1]
    body += lastTag(y(last), Math.round(last).toLocaleString('en-US'))
    return body + times(326)
  },
  macd() {
    const warm = 30, n = 60
    const all = candles(n + warm, (t) => 2230 + 46 * Math.sin(t * 7.2 - 0.6) + 20 * t, 23, 7)
    const closes = all.map((c) => c.close), fast = emaOf(closes, 12), slow = emaOf(closes, 26)
    const macdAll = fast.map((f, i) => f - slow[i]), sigAll = emaOf(macdAll, 9)
    const macd = macdAll.slice(warm), sig = sigAll.slice(warm), hist = macd.map((m, i) => m - sig[i]), px = closes.slice(warm)
    const x = (i) => SG.left + 4 + (i * (SG.right - SG.left - 8)) / (n - 1), bw = ((SG.right - SG.left) / n) * 0.6
    const y = invertible(px, 18, 160)
    const lim = Math.max(...macd.map(Math.abs), ...sig.map(Math.abs)) * 1.1, m = (v) => fx(246 - (v / lim) * 50)
    let body = grid(18, 160, 3, y, (yy) => Math.round(y.inv(yy)).toLocaleString('en-US'), y(px[n - 1]))
    body += `<path class="sg-level" d="M${SG.left} 246H${SG.right}"/><text class="sg-ax" x="${SG.axis}" y="250" text-anchor="end">0</text><text class="sg-ax sg-dimtxt" x="${SG.left}" y="188">MACD 12 26 9</text>`
    const area = line(px, x, y)
    body += `<g class="sg-plot"><path class="sg-area" d="${area}L${fx(x(n - 1))} 160L${fx(x(0))} 160Z"/><path class="sg-price" d="${area}"/>`
    hist.forEach((h, i) => { body += `<rect class="sg-hist ${h >= 0 ? 'up' : 'down'}${i > 0 && Math.abs(h) < Math.abs(hist[i - 1]) ? ' fading' : ''}" x="${fx(x(i) - bw / 2)}" y="${Math.min(m(h), 246)}" width="${fx(bw)}" height="${Math.max(0.8, fx(Math.abs(m(h) - 246)))}" rx="1"/>` })
    body += `<path class="sg-sig" d="${line(sig, x, m)}"/><path class="sg-macd" d="${line(macd, x, m)}"/></g>`
    const recent = crossings(macd, sig, 3).slice(-3), all3 = recent.length
    recent.forEach((c, k) => {
      const cls = c.up ? 'buy' : 'sell', d = 1.3 + k * 0.3
      body += `<path class="sg-guide ${cls} sg-mk" style="--d:${d}s" d="M${fx(x(c.i))} ${y(px[c.i])}V${m(macd[c.i])}"/>`
      body += marker(x(c.i), m(macd[c.i]), cls, d + 0.1) + marker(x(c.i), y(px[c.i]), cls, d, k === all3 - 1 ? (c.up ? 'BULLISH CROSS' : 'BEARISH CROSS') : '', y(px[c.i]) - 32)
    })
    const last = px[n - 1]
    body += lastTag(y(last), Math.round(last).toLocaleString('en-US'))
    body += `<g class="sg-key" transform="translate(${SG.left + 140} 184)"><path class="sg-macd" d="M0 0h14"/><text x="20" y="4">MACD</text><path class="sg-sig" d="M66 0h14"/><text x="86" y="4">SIGNAL</text></g>`
    return body + times(326)
  },
}
function showSignal(name) {
  const signal = signals[name]
  document.querySelectorAll('[data-signal]').forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.signal === name)))
  document.querySelector('#signal-kicker').textContent = signal.kicker
  document.querySelector('.signal-meta .eyebrow:last-child').textContent = signal.code
  document.querySelector('#signal-title').replaceChildren(document.createTextNode(signal.title[0]), document.createElement('br'), document.createTextNode(signal.title[1]))
  document.querySelector('#signal-description').textContent = signal.description
  const chart = document.querySelector('#signal-chart')
  chart.setAttribute('viewBox', '0 0 600 344')
  chart.innerHTML = charts[name]()
  chart.setAttribute('aria-label', `Illustrative ${signal.kicker.toLowerCase()}, not trading performance`)
}
showSignal('sma')
document.querySelectorAll('[data-signal]').forEach((button) => button.addEventListener('click', () => {
  showSignal(button.dataset.signal)
  sectionMotion?.drawSignal()
}))

// Original Blender render. Playback follows visibility and the shared motion
// controls; seeking never touches the trading application or its APIs.
function createMetalFilm() {
  const root = document.querySelector('#metal-film')
  const video = root.querySelector('video')
  const buttons = [...document.querySelectorAll('[data-film-step]')]
  const label = document.querySelector('#film-label')
  const names = ['Your strategy, engineered.', 'Every layer, connected.', 'One system. In motion.']
  let stopped = paused, visible = false, suspended = false, callback = 0, active = -1, generation = 0
  video.muted = true
  const duration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 8
  function draw() {
    const progress = clamp(video.currentTime / duration(), 0, .9999)
    const index = Math.min(2, Math.floor(progress * 3))
    if (index !== active) {
      active = index
      root.dataset.phase = String(index)
      label.textContent = `0${index + 1} / ${names[index]}`
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)))
    }
    buttons.forEach((button, i) => button.style.setProperty('--step-progress', String(clamp(progress * 3 - i))))
  }
  function onFrame() {
    callback = 0; draw()
    if (!video.paused && visible && !document.hidden) callback = video.requestVideoFrameCallback(onFrame)
  }
  function cancelFrame() {
    if (callback) video.cancelVideoFrameCallback(callback)
    callback = 0
  }
  function sync() {
    const run = ++generation
    const shouldPlay = !stopped && visible && !document.hidden && !suspended
    root.dataset.playing = String(shouldPlay)
    if (shouldPlay) {
      video.play().then(() => {
        if (run === generation && !callback && !video.paused && video.requestVideoFrameCallback) callback = video.requestVideoFrameCallback(onFrame)
      }).catch(() => { if (run === generation && !stopped && visible && !document.hidden) setMotion(true) })
    } else { video.pause(); cancelFrame() }
    draw()
  }
  video.addEventListener('timeupdate', draw)
  video.addEventListener('loadedmetadata', draw)
  video.addEventListener('seeked', draw)
  video.addEventListener('playing', () => { root.dataset.ready = 'true' })
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() }, { threshold: .08 }).observe(root)
  document.addEventListener('visibilitychange', sync)
  addEventListener('pagehide', () => { suspended = true; sync() })
  addEventListener('pageshow', () => { suspended = false; sync() })
  buttons.forEach((button, index) => button.addEventListener('click', () => {
    setMotion(true)
    const seek = () => { video.currentTime = duration() * (index / 3 + .1); draw() }
    if (video.readyState >= 1) seek()
    else video.addEventListener('loadedmetadata', seek, { once: true })
  }))
  draw()
  return { setPaused(value) { stopped = value; sync() } }
}

// Section entrances run only while entering the viewport. Independent translate /
// scale properties preserve the existing 3D transforms, hover states and parallax.
function createSectionMotion() {
  if (!('IntersectionObserver' in window) || !Element.prototype.animate) return { setPaused() {}, drawSignal() {} }
  const records = []
  const byAnchor = new Map()
  const ease = 'cubic-bezier(.16, 1, .3, 1)'
  let disabled = paused
  let drawing = []
  const ownStyles = ['opacity', 'translate', 'scale']
  const resetStyles = (element) => ownStyles.forEach((property) => element.style.removeProperty(property))
  function letters(heading) {
    const accessible = heading.cloneNode(true)
    accessible.querySelectorAll('br').forEach((br) => br.replaceWith(' '))
    heading.setAttribute('aria-label', accessible.textContent.replace(/\s+/g, ' ').trim())
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    const chars = []
    for (const text of nodes) {
      const fragment = document.createDocumentFragment()
      for (const part of text.textContent.split(/(\s+)/)) {
        if (!part || /^\s+$/.test(part)) { fragment.append(document.createTextNode(part)); continue }
        const word = document.createElement('span')
        word.className = 'motion-word'
        word.setAttribute('aria-hidden', 'true')
        for (const char of Array.from(part)) {
          const letter = document.createElement('span')
          letter.className = 'motion-char'
          letter.textContent = char
          word.append(letter)
          chars.push(letter)
        }
        fragment.append(word)
      }
      text.replaceWith(fragment)
    }
    return chars
  }
  function add(selector, options = {}) {
    document.querySelectorAll(selector).forEach((element, index) => {
      const record = {
        element,
        anchor: options.anchor ? element.querySelector(options.anchor) || element : element,
        chars: options.heading ? letters(element) : null,
        from: { opacity: 0, translate: `${options.x || 0}px ${options.y ?? 38}px`, scale: String(options.scale || 1) },
        delay: (options.delay || 0) + Math.min(index * (options.stagger || 0), 280),
        duration: options.duration || 1050,
        onEnter: options.onEnter,
        state: 'pending',
        entered: false,
        intersecting: false,
        animations: [],
        generation: 0,
      }
      element.classList.add('section-reveal')
      element.dataset.revealState = 'pending'
      records.push(record)
      const bucket = byAnchor.get(record.anchor) || []
      bucket.push(record)
      byAnchor.set(record.anchor, bucket)
    })
  }
  function cancel(record) {
    record.generation++
    record.animations.forEach((animation) => animation.cancel())
    record.animations = []
    record.element.classList.remove('is-entering')
  }
  function settle(record) {
    cancel(record)
    resetStyles(record.element)
    record.chars?.forEach((char) => { char.style.removeProperty('opacity'); char.style.removeProperty('transform') })
    record.state = 'visible'
    record.element.dataset.revealState = 'visible'
  }
  function prepare(record) {
    cancel(record)
    if (record.chars) record.chars.forEach((char) => { char.style.opacity = '0' })
    else Object.assign(record.element.style, record.from)
    record.state = 'pending'
    record.element.dataset.revealState = 'pending'
  }
  function animate(record) {
    if (disabled) { settle(record); return }
    if (record.state !== 'pending') return
    record.state = 'entering'
    record.entered = true
    record.element.dataset.revealState = 'entering'
    record.element.classList.add('is-entering')
    const generation = ++record.generation
    if (record.chars) {
      record.animations = record.chars.map((char, index) => char.animate([
        { opacity: 0, transform: `translate3d(${(index % 3 - 1) * 3}px, ${24 + index % 4 * 4}px, 0) rotate(${(index % 3 - 1) * 3}deg)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0) rotate(0deg)' },
      ], { duration: 900, delay: record.delay + Math.min(index * 14, 420), easing: ease, fill: 'both' }))
    } else {
      record.animations = [record.element.animate([
        record.from,
        { opacity: 1, translate: '0px 0px', scale: '1' },
      ], { duration: record.duration, delay: record.delay, easing: ease, fill: 'both' })]
    }
    record.onEnter?.()
    Promise.all(record.animations.map((animation) => animation.finished.catch(() => {}))).then(() => {
      if (generation === record.generation && record.state === 'entering') settle(record)
    })
  }
  function drawSignal(short = false) {
    drawing.forEach((animation) => animation.cancel())
    drawing = []
    if (disabled) return
    const plot = document.querySelector('#signal-chart .sg-plot')
    if (plot) drawing.push(plot.animate([
      { clipPath: 'inset(-10% 100% -10% -2%)' },
      { clipPath: 'inset(-10% -2% -10% -2%)' },
    ], { duration: short ? 800 : 1700, delay: short ? 0 : 280, easing: 'cubic-bezier(.25,.7,.2,1)', fill: 'backwards' }))
    document.querySelectorAll('#signal-chart .sg-mk, #signal-chart .sg-last, #signal-chart .sg-live').forEach((el) => {
      const d = parseFloat(el.style.getPropertyValue('--d')) || 1.9
      drawing.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: (short ? d * 0.55 : d) * 1000, fill: 'backwards', easing: ease }))
    })
  }

  // Headings assemble letter by letter; adjacent content follows in short waves.
  add('.text-reveal', { heading: true, delay: 20 })
  add('.overview-intro > p', { y: 30, delay: 180 })
  add('.signal-panel', { y: 76, scale: .95, duration: 1350, delay: 90, onEnter: () => drawSignal() })
  add('.mini-feature', { x: 35, y: 25, delay: 140, stagger: 90, duration: 1150 })
  add('.stack-heading > .eyebrow', { y: 18 })
  add('.stack-step .step-heading', { y: 36, duration: 1050 })
  add('.stack-step .step-copy', { y: 28, delay: 160, duration: 1100 })
  add('.software-stack', { x: 72, y: 48, scale: .94, duration: 1550, anchor: '.software-chamber' })
  add('.blueprint-mark', { y: 24, scale: .92, duration: 1100 })
  add('.blueprint-actions', { y: 24, delay: 220 })
  add('.infra-node', { x: 38, y: 26, delay: 90, stagger: 110, duration: 1250 })
  add('.opportunity-heading > *', { y: 22, stagger: 120 })
  add('.opportunity-points article', { y: 38, stagger: 90, duration: 1200 })
  add('.sheet-back', { x: 65, y: 64, scale: .94, duration: 1500 })
  add('.sheet-front', { x: 54, y: 85, scale: .94, delay: 130, duration: 1550 })
  add('.trace-row', { x: 20, y: 5, delay: 320, stagger: 80, duration: 850 })
  add('.collection-heading .eyebrow, .collection-heading > .button', { y: 20, stagger: 110 })
  add('.collection-card', { y: 64, scale: .97, stagger: 120, duration: 1250 })
  add('.faq-list details', { y: 28, stagger: 65, duration: 1000 })
  add('.footer-links > *', { y: 32, stagger: 90, duration: 1100 })
  add('.footer-base > *', { y: 18, delay: 120, stagger: 70 })

  // A separate, expanded exit boundary avoids re-triggering on tiny scrolls.
  // Replays are prepared only after the element has completely left the screen.
  const entrance = new IntersectionObserver((entries) => {
    for (const entry of entries) for (const record of byAnchor.get(entry.target) || []) {
      record.intersecting = entry.isIntersecting
      if (entry.isIntersecting) animate(record)
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0 })
  const departure = new IntersectionObserver((entries) => {
    for (const entry of entries) if (!entry.isIntersecting && !disabled) {
      for (const record of byAnchor.get(entry.target) || []) if (record.entered && record.state !== 'pending') prepare(record)
    }
  }, { rootMargin: '18% 0px 18% 0px', threshold: 0 })
  records.forEach((record) => disabled ? settle(record) : prepare(record))
  byAnchor.forEach((_, anchor) => { entrance.observe(anchor); departure.observe(anchor) })
  document.addEventListener('focusin', (event) => {
    records.forEach((record) => {
      if (record.element.contains(event.target)) { record.entered = true; settle(record) }
    })
  })
  return {
    drawSignal: () => drawSignal(true),
    setPaused(value) {
      if (disabled === value) return
      disabled = value
      if (disabled) {
        drawing.forEach((animation) => animation.cancel())
        records.forEach(settle)
      } else {
        records.forEach((record) => {
          const rect = record.anchor.getBoundingClientRect()
          if (rect.bottom < 0 || rect.top > innerHeight) prepare(record)
          else settle(record)
        })
      }
    },
  }
}
