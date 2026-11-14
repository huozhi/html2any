'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { HtmlRoot } from '../../../src/stream'
import { CanvasRenderer, FRAME_SKELETON, type RendererCallbacks } from './canvas-renderer'

export type Device = 'desktop' | 'tablet' | 'mobile'

const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 }

type CanvasProps = {
  root: HtmlRoot
  streaming: boolean
  selected: string | null
  hovered: string | null
  baseUrl: string
  device: Device
  labelFor: (id: string) => string
  rendererRef: MutableRefObject<CanvasRenderer | null>
  callbacks: RendererCallbacks
  onRendered: () => void
}

export function Canvas(props: CanvasProps) {
  const { root, streaming, selected, hovered, baseUrl, device, rendererRef, labelFor, onRendered } = props
  const frameRef = useRef<HTMLIFrameElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)
  const callbacksRef = useRef(props.callbacks)
  callbacksRef.current = props.callbacks
  const [ready, setReady] = useState(false)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const labelRef = useRef(labelFor)
  labelRef.current = labelFor

  const updateBadge = useCallback(() => {
    const badge = badgeRef.current
    const frame = frameRef.current
    const renderer = rendererRef.current
    const id = selectedRef.current
    if (!badge || !frame || !renderer) return
    const el = id ? renderer.getElement(id) : null
    if (!el || el === frame.contentDocument?.body) {
      badge.style.display = 'none'
      return
    }
    const rect = el.getBoundingClientRect()
    const frameHeight = frame.clientHeight
    if (rect.bottom < 0 || rect.top > frameHeight) {
      badge.style.display = 'none'
      return
    }
    badge.textContent = labelRef.current(id as string)
    badge.style.display = 'block'
    const top = rect.top < 24 ? Math.max(0, rect.top) + 4 : rect.top - 22
    badge.style.transform = `translate(${Math.max(0, rect.left) + frame.offsetLeft}px, ${top + frame.offsetTop}px)`
  }, [rendererRef])

  // Create the renderer once the frame document is ready.
  const onLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    rendererRef.current?.dispose()
    rendererRef.current = new CanvasRenderer(doc, {
      onSelect: id => callbacksRef.current.onSelect(id),
      onHover: id => callbacksRef.current.onHover(id),
      onCommitText: (id, html) => callbacksRef.current.onCommitText(id, html),
      onEditingChange: id => callbacksRef.current.onEditingChange(id),
      onKeyDown: e => callbacksRef.current.onKeyDown(e),
      onViewportChange: () => updateBadge(),
    })
    setReady(true)
  }, [rendererRef, updateBadge])

  useEffect(() => {
    // The srcdoc frame may finish loading before hydration attaches onLoad.
    const doc = frameRef.current?.contentDocument
    if (doc && doc.readyState === 'complete' && doc.querySelector('style[data-h2a-editor]')) onLoad()
    return () => rendererRef.current?.dispose()
  }, [rendererRef, onLoad])

  useEffect(() => {
    if (!ready) return
    rendererRef.current?.setBaseUrl(baseUrl)
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
    updateBadge()
  }, [ready, selected, rendererRef, updateBadge, root])

  useEffect(() => {
    if (!ready) return
    rendererRef.current?.setHovered(hovered)
  }, [ready, hovered, rendererRef])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(() => updateBadge())
    observer.observe(stage)
    return () => observer.disconnect()
  }, [updateBadge])

  const width = DEVICE_WIDTH[device]

  return (
    <div className="h2e-stage" ref={stageRef}>
      <div className={`h2e-frame-wrap${width ? ' is-device' : ''}`} style={width ? { width } : undefined}>
        <iframe
          ref={frameRef}
          className="h2e-frame"
          title="Page canvas"
          srcDoc={FRAME_SKELETON}
          onLoad={onLoad}
        />
        <div className="h2e-badge" ref={badgeRef} />
      </div>
    </div>
  )
}
