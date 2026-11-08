import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { dropIndex, shiftFor } from './menuOrder'

const LONG_PRESS_MS = 400
const MOVE_TOLERANCE = 10
const EDGE = 80

// Sıralanabilir liste: oklarla (her cihazda, klavyeyle de) veya sürükleyerek.
//  - Fare: tutamaçtan (⋮⋮) tutup sürükle.
//  - Dokunmatik: satıra uzun bas (titreşir), sonra sürükle; tutamaçtan anında sürüklenir. Kısa kaydırma sayfayı kaydırır.
// onMove(from, to) yalnızca bırakınca bir kez çağrılır; kayıt üst bileşendedir.
export default function SortableList({ items, getKey, getLabel, onMove, disabled = false, renderItem }) {
  const rows = useRef([])
  const session = useRef(null)
  const [drag, setDrag] = useState(null) // { from, over, dy, step }
  const [settling, setSettling] = useState(false)

  useEffect(() => () => session.current?.stop(), [])

  const docY = clientY => clientY + window.scrollY

  function begin(s) {
    const rects = items.map((_, i) => {
      const rect = rows.current[i]?.getBoundingClientRect() ?? { top: 0, height: 0, bottom: 0 }
      return { top: rect.top + window.scrollY, height: rect.height, bottom: rect.bottom + window.scrollY }
    })
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0
    Object.assign(s, { active: true, rects, startDoc: docY(s.lastY), over: s.from })
    navigator.vibrate?.(12)
    setDrag({ from: s.from, over: s.from, dy: 0, step: rects[s.from].height + gap })
    autoScroll(s)
  }

  function update(s) {
    const dy = docY(s.lastY) - s.startDoc
    const rect = s.rects[s.from]
    s.over = dropIndex(s.rects, s.from, rect.top + rect.height / 2 + dy)
    setDrag(current => current && { ...current, dy, over: s.over })
  }

  // Parmak/fare ekran kenarına yaklaşınca sayfa kendiliğinden kayar.
  function autoScroll(s) {
    const tick = () => {
      if (session.current !== s || !s.active) return
      const speed = s.lastY < EDGE ? -(EDGE - s.lastY) / 6 : s.lastY > innerHeight - EDGE ? (s.lastY - (innerHeight - EDGE)) / 6 : 0
      if (speed) { window.scrollBy(0, speed); update(s) }
      s.frame = requestAnimationFrame(tick)
    }
    s.frame = requestAnimationFrame(tick)
  }

  function finish(s, commit) {
    s.stop()
    if (!s.active) return
    setDrag(null)
    if (commit && s.over !== s.from) {
      // Satırlar yeni yerlerine geçerken kayma animasyonu bir kare kapalı: zıplama olmaz.
      setSettling(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)))
      onMove(s.from, s.over)
    }
  }

  function start(index, clientX, clientY, mode, immediate) {
    if (disabled || session.current || items.length < 2) return
    const s = { from: index, startX: clientX, startY: clientY, lastY: clientY, active: false, listeners: [] }
    const listen = (type, fn, options) => { window.addEventListener(type, fn, options); s.listeners.push([type, fn, options]) }
    s.stop = () => {
      clearTimeout(s.timer)
      cancelAnimationFrame(s.frame)
      for (const [type, fn, options] of s.listeners) window.removeEventListener(type, fn, options)
      if (session.current === s) session.current = null
    }
    session.current = s
    const moveTo = (x, y, event) => {
      if (!s.active) {
        if (Math.hypot(x - s.startX, y - s.startY) > MOVE_TOLERANCE) s.stop() // kaydırma: sürükleme değil
        return
      }
      if (event?.cancelable) event.preventDefault()
      s.lastY = y
      update(s)
    }
    if (mode === 'touch') {
      listen('touchmove', event => { const t = event.touches[0]; if (t) moveTo(t.clientX, t.clientY, event) }, { passive: false })
      listen('touchend', () => finish(s, true))
      listen('touchcancel', () => finish(s, false))
    } else {
      listen('mousemove', event => moveTo(event.clientX, event.clientY, event))
      listen('mouseup', () => finish(s, true))
    }
    listen('keydown', event => { if (event.key === 'Escape') finish(s, false) })
    if (immediate) begin(s)
    else s.timer = setTimeout(() => begin(s), LONG_PRESS_MS)
  }

  const onTouchStart = index => event => {
    if (event.touches.length !== 1) return
    const onGrip = event.target.closest('[data-sort-grip]')
    if (!onGrip && event.target.closest('button, a, input, select, textarea, label')) return
    const t = event.touches[0]
    start(index, t.clientX, t.clientY, 'touch', Boolean(onGrip))
  }

  const onGripMouseDown = index => event => {
    if (event.button !== 0) return
    event.preventDefault()
    start(index, event.clientX, event.clientY, 'mouse', true)
  }

  const move = (index, direction) => {
    const to = index + direction
    if (!disabled && to >= 0 && to < items.length) onMove(index, to)
  }

  return (
    <div className={`data-list sortable-list${drag ? ' is-dragging' : ''}${settling ? ' is-settling' : ''}`}>
      {items.map((item, index) => {
        const dragging = drag?.from === index
        const offset = dragging ? drag.dy : shiftFor(index, drag?.from, drag?.over, drag?.step ?? 0)
        const label = getLabel(item)
        return (
          <div key={getKey(item)} ref={el => { rows.current[index] = el }}
            className={`sortable-row${dragging ? ' dragging' : ''}`}
            style={offset ? { transform: `translate3d(0, ${offset}px, 0)` } : undefined}
            onTouchStart={onTouchStart(index)}
            onContextMenu={event => { if (session.current) event.preventDefault() }}>
            {renderItem(item, {
              grip: (
                <span className="sort-grip" data-sort-grip="" onMouseDown={onGripMouseDown(index)} title="Sürükleyerek sırala" aria-hidden="true">
                  <GripVertical size={16} />
                </span>
              ),
              arrows: (
                <span className="sort-arrows">
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={disabled || index === 0}
                    onClick={() => move(index, -1)} aria-label={`${label} yukarı taşı`} title="Yukarı taşı"><ArrowUp size={13} /></button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={disabled || index === items.length - 1}
                    onClick={() => move(index, 1)} aria-label={`${label} aşağı taşı`} title="Aşağı taşı"><ArrowDown size={13} /></button>
                </span>
              ),
            })}
          </div>
        )
      })}
    </div>
  )
}
