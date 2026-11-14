'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import type { HtmlRoot } from '../../../src/stream'
import { CanvasRenderer, FRAME_SKELETON, type RendererCallbacks } from './canvas-renderer'

export type Device = 'desktop' | 'tablet' | 'mobile'

const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 }
const GAP = 8

type CanvasProps = {
  root: HtmlRoot
  streaming: boolean
  selected: string | null
  hovered: string | null
  baseUrl: string
  device: Device
  rendererRef: MutableRefObject<CanvasRenderer | null>
  callbacks: RendererCallbacks
  onRendered: () => void
  /** Floating toolbar shown next to the selected element. */
  toolbar: ReactNode
}

export function Canvas(props: CanvasProps) {
  const { root, streaming, selected, hovered, baseUrl, device, rendererRef, onRendered, toolbar } = props
  const frameRef = useRef<HTMLIFrameElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const callbacksRef = useRef(props.callbacks)
  callbacksRef.current = props.callbacks
  const [ready, setReady] = useState(false)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const renderedRef = useRef(onRendered)
  renderedRef.current = onRendered

  /** Place the toolbar above the selected element, or below when there is no room. */
  const placeToolbar = useCallback(() => {
    const bar = barRef.current
    const frame = frameRef.current
    const wrap = wrapRef.current
    const renderer = rendererRef.current
    const id = selectedRef.current
    if (!bar || !frame || !wrap || !renderer) return
    const el = id ? renderer.getElement(id) : null
    const rect = el?.getBoundingClientRect()
    const height = frame.clientHeight
    if (!rect || rect.bottom < 0 || rect.top > height || !bar.firstElementChild) {
      bar.style.visibility = 'hidden'
      return
    }
    const barWidth = bar.offsetWidth
    const barHeight = bar.offsetHeight
    let top = rect.top - barHeight - GAP
    if (top < GAP) top = rect.bottom + GAP
    if (top + barHeight > height - GAP) top = Math.max(GAP, Math.min(rect.top + GAP, height - barHeight - GAP))
    const left = Math.max(GAP, Math.min(rect.left, wrap.clientWidth - barWidth - GAP))
    bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    bar.style.visibility = 'visible'
  }, [rendererRef])

  const onLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    rendererRef.current?.dispose()
    rendererRef.current = new CanvasRenderer(doc, {
      onSelect: (chain, clicks) => callbacksRef.current.onSelect(chain, clicks),
      onHover: chain => callbacksRef.current.onHover(chain),
      onCommitText: (id, html) => callbacksRef.current.onCommitText(id, html),
      onEditingChange: id => callbacksRef.current.onEditingChange(id),
      onKeyDown: e => callbacksRef.current.onKeyDown(e),
      onViewportChange: () => placeToolbar(),
    })
    setReady(true)
  }, [rendererRef, placeToolbar])

  useEffect(() => {
    // The srcdoc frame may finish loading before hydration attaches onLoad.
    const doc = frameRef.current?.contentDocument
    if (doc && doc.readyState === 'complete' && doc.querySelector('style[data-h2a-editor]')) onLoad()
    return () => rendererRef.current?.dispose()
  }, [rendererRef, onLoad])

  useEffect(() => {
    if (ready) rendererRef.current?.setBaseUrl(baseUrl)
  }, [ready, baseUrl, rendererRef])

  useEffect(() => {
    if (!ready || !rendererRef.current) return
    rendererRef.current.setReadOnly(streaming)
    rendererRef.current.render(root, streaming)
    onRendered()
  }, [ready, root, streaming, rendererRef, onRendered])

  useEffect(() => {
    if (!ready || !rendererRef.current) return
    rendererRef.current.setSelected(selected)
    if (selected) rendererRef.current.scrollIntoView(selected)
  }, [ready, selected, rendererRef])

  useEffect(() => {
    if (ready) rendererRef.current?.setHovered(hovered)
  }, [ready, hovered, rendererRef])

  // Re-place after every render: the toolbar's content and the element's box may both change.
  useLayoutEffect(() => {
    placeToolbar()
  })

  useEffect(() => {
    const wrap = wrapRef.current
    const bar = barRef.current
    if (!wrap || !bar) return
    const observer = new ResizeObserver(entries => {
      placeToolbar()
      // The canvas width changed: layout (and computed sizes) changed with it.
      if (entries.some(entry => entry.target === wrap)) renderedRef.current()
    })
    observer.observe(wrap)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [placeToolbar])

  const width = DEVICE_WIDTH[device]

  return (
    <div className="h2e-stage">
      <div ref={wrapRef} className={`h2e-frame-wrap${width ? ' is-device' : ''}`} style={width ? { width } : undefined}>
        <iframe ref={frameRef} className="h2e-frame" title="Page canvas" srcDoc={FRAME_SKELETON} onLoad={onLoad} />
        <div className="h2e-floating" ref={barRef}>{toolbar}</div>
      </div>
    </div>
  )
}
