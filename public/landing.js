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

const signals = {
  sma: {
    kicker: 'Moving average crossover', code: 'SMA / 01', title: ['A clearer view', 'of momentum.'], description: 'Watch the signal. Test the thesis.',
    price: 'M0 270C55 276 90 275 132 255S210 212 260 186 365 132 440 90 540 45 600 9',
    average: 'M0 248C80 258 120 276 180 246S300 179 390 145 510 84 600 55',
  },
  rsi: {
    kicker: 'Relative strength index', code: 'RSI / 02', title: ['A perspective', 'on the extremes.'], description: 'Look for stretched momentum.',
    price: 'M0 150C40 150 45 60 90 60S150 300 200 300 260 40 310 40 360 220 410 220 490 100 540 100 570 160 600 160',
    average: 'M0 85H600M0 255H600',
  },
  macd: {
    kicker: 'Moving average convergence', code: 'MACD / 03', title: ['Follow a shift', 'in direction.'], description: 'See momentum take a new shape.',
    price: 'M0 190C70 280 140 290 205 220S320 60 390 80 520 230 600 150',
    average: 'M0 170C70 200 140 270 205 240S320 110 390 115 520 180 600 170',
  },
}
document.querySelectorAll('[data-signal]').forEach((button) => button.addEventListener('click', () => {
  const signal = signals[button.dataset.signal]
  document.querySelectorAll('[data-signal]').forEach((tab) => tab.setAttribute('aria-pressed', String(tab === button)))
  document.querySelector('#signal-kicker').textContent = signal.kicker
  document.querySelector('.signal-meta .eyebrow:last-child').textContent = signal.code
  document.querySelector('#signal-title').replaceChildren(document.createTextNode(signal.title[0]), document.createElement('br'), document.createTextNode(signal.title[1]))
  document.querySelector('#signal-description').textContent = signal.description
  document.querySelector('#chart-price').setAttribute('d', signal.price)
  document.querySelector('#chart-average').setAttribute('d', signal.average)
  document.querySelector('#chart-area').setAttribute('d', `${signal.price}V340H0Z`)
  document.querySelector('#signal-chart').setAttribute('aria-label', `Illustrative ${signal.kicker.toLowerCase()}, not trading performance`)
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
    const paths = [...document.querySelectorAll('#chart-price, #chart-average')]
    paths.forEach((path, index) => drawing.push(path.animate([
      { clipPath: 'inset(-8% 100% -8% -8%)' },
      { clipPath: 'inset(-8% -8% -8% -8%)' },
    ], { duration: short ? 700 : 1700, delay: short ? index * 50 : 280 + index * 130, easing: 'cubic-bezier(.25,.7,.2,1)', fill: 'backwards' })))
    const area = document.querySelector('#chart-area')
    drawing.push(area.animate([{ opacity: 0 }, { opacity: 1 }], { duration: short ? 500 : 1200, delay: short ? 80 : 600, fill: 'backwards', easing: ease }))
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
