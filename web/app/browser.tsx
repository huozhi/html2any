'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, JSX, MouseEvent, ReactNode } from 'react'
import { htmlToMarkdown } from '../../src/context'

const DEFAULT_URL = 'https://huozhi.im/crafts'

type AttrValue = string | boolean
type HistoryMode = 'move' | 'push' | 'replace'
type LoadOptions = {
  historyIndex?: number
  historyMode?: HistoryMode
}
type NavigationState = {
  entries: string[]
  index: number
}
type LoadResponse = {
  error?: string
  html: string
  url: string
}
type Bookmark = {
  icon: string
  label: string
  url: string
}

const bookmarks: Bookmark[] = [
  {
    icon: 'H',
    label: 'huozhi.im',
    url: 'http://huozhi.im',
  },
  {
    icon: 'M',
    label: 'mdn fetch',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
  },
  {
    icon: 'N',
    label: 'node fs',
    url: 'https://nodejs.org/api/fs.html',
  },
  {
    icon: 'Y',
    label: 'hacker news',
    url: 'https://news.ycombinator.com',
  },
]

const skippedBrowserTags = ['head', 'script', 'style', 'meta', 'link', 'title', 'noscript', 'template', 'iframe', 'object', 'embed']
const noWhitespaceTextChildTags = ['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'optgroup']
const voidBrowserTags = ['area', 'base', 'br', 'col', 'hr', 'input', 'param', 'source', 'track', 'wbr']
const nativeBrowserTags = [
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'button',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'i',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'menu',
  'meter',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'select',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
]

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function normalizeAddress(value: string, baseUrl = '') {
  const trimmedUrl = value.trim()

  if (!trimmedUrl) {
    throw new Error('URL is required.')
  }

  if (/^https?:\/\//i.test(trimmedUrl)) {
    return new URL(trimmedUrl).toString()
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmedUrl)) {
    throw new Error('Only http and https URLs are supported.')
  }

  if (trimmedUrl.startsWith('//')) {
    return new URL(`http:${trimmedUrl}`).toString()
  }

  if (baseUrl && /^[/?#]/.test(trimmedUrl)) {
    return new URL(trimmedUrl, baseUrl).toString()
  }

  return new URL(`http://${trimmedUrl}`).toString()
}

function resolveBrowserUrl(value: AttrValue | undefined, baseUrl: string) {
  if (!value || value === true) {
    return ''
  }

  const trimmedUrl = String(value).trim()
  if (!trimmedUrl || /^(javascript|mailto|tel|data|blob):/i.test(trimmedUrl)) {
    return ''
  }

  try {
    const url = baseUrl ? new URL(trimmedUrl, baseUrl) : new URL(normalizeAddress(trimmedUrl))
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

function textAttr(value: AttrValue | undefined) {
  return typeof value === 'string' ? value : ''
}

function booleanAttr(element: Element, name: string) {
  return element.hasAttribute(name)
}

function stringAttr(element: Element, name: string) {
  const value = element.getAttribute(name)
  return value == null ? undefined : value
}

function assignStringAttr(props: Record<string, unknown>, element: Element, attr: string, prop = attr) {
  const value = stringAttr(element, attr)
  if (value != null) {
    props[prop] = value
  }
}

function selectedOptionValues(element: Element) {
  return Array.from(element.querySelectorAll('option'))
    .filter(option => option.hasAttribute('selected'))
    .map(option => option.getAttribute('value') ?? option.textContent ?? '')
}

function getDisplayProps(element: Element, tagName: string, baseUrl: string) {
  const props: Record<string, unknown> = {}

  assignStringAttr(props, element, 'title')
  if (element.hasAttribute('hidden')) {
    props.hidden = true
  }

  if (tagName === 'input') {
    assignStringAttr(props, element, 'type')
    assignStringAttr(props, element, 'placeholder')
    assignStringAttr(props, element, 'value', 'defaultValue')
    assignStringAttr(props, element, 'min')
    assignStringAttr(props, element, 'max')
    assignStringAttr(props, element, 'step')
    assignStringAttr(props, element, 'size')
    assignStringAttr(props, element, 'maxlength', 'maxLength')
    assignStringAttr(props, element, 'pattern')
    assignStringAttr(props, element, 'autocomplete', 'autoComplete')
    assignStringAttr(props, element, 'inputmode', 'inputMode')
    props.defaultChecked = booleanAttr(element, 'checked')
    props.disabled = booleanAttr(element, 'disabled')
    props.readOnly = booleanAttr(element, 'readonly')
    props.required = booleanAttr(element, 'required')
    props.multiple = booleanAttr(element, 'multiple')
    return props
  }

  if (tagName === 'textarea') {
    assignStringAttr(props, element, 'placeholder')
    assignStringAttr(props, element, 'rows')
    assignStringAttr(props, element, 'cols')
    assignStringAttr(props, element, 'maxlength', 'maxLength')
    props.defaultValue = element.getAttribute('value') ?? element.textContent ?? ''
    props.disabled = booleanAttr(element, 'disabled')
    props.readOnly = booleanAttr(element, 'readonly')
    props.required = booleanAttr(element, 'required')
    return props
  }

  if (tagName === 'select') {
    assignStringAttr(props, element, 'size')
    const selected = selectedOptionValues(element)
    props.defaultValue = booleanAttr(element, 'multiple') ? selected : selected[0]
    props.disabled = booleanAttr(element, 'disabled')
    props.required = booleanAttr(element, 'required')
    props.multiple = booleanAttr(element, 'multiple')
    return props
  }

  if (tagName === 'option') {
    assignStringAttr(props, element, 'value')
    assignStringAttr(props, element, 'label')
    props.disabled = booleanAttr(element, 'disabled')
    return props
  }

  if (tagName === 'button') {
    assignStringAttr(props, element, 'type')
    assignStringAttr(props, element, 'value')
    props.disabled = booleanAttr(element, 'disabled')
    return props
  }

  if (tagName === 'progress' || tagName === 'meter') {
    for (const attr of ['value', 'min', 'max', 'low', 'high', 'optimum']) {
      assignStringAttr(props, element, attr)
    }
    return props
  }

  if (tagName === 'details') {
    props.open = booleanAttr(element, 'open')
    return props
  }

  if (tagName === 'ol') {
    assignStringAttr(props, element, 'start')
    assignStringAttr(props, element, 'type')
    props.reversed = booleanAttr(element, 'reversed')
    return props
  }

  if (tagName === 'li') {
    assignStringAttr(props, element, 'value')
    return props
  }

  if (tagName === 'td' || tagName === 'th') {
    assignStringAttr(props, element, 'colspan', 'colSpan')
    assignStringAttr(props, element, 'rowspan', 'rowSpan')
    return props
  }

  if (tagName === 'video' || tagName === 'audio') {
    const src = resolveBrowserUrl(element.getAttribute('src') || undefined, baseUrl)
    if (src) {
      props.src = src
    }
    props.controls = booleanAttr(element, 'controls')
    props.loop = booleanAttr(element, 'loop')
    props.muted = booleanAttr(element, 'muted')
    assignStringAttr(props, element, 'width')
    assignStringAttr(props, element, 'height')
    assignStringAttr(props, element, 'poster')
    return props
  }

  return props
}

function renderBrowserContent(html: string, baseUrl: string, onNavigate: (url: string) => void) {
  if (!html || typeof DOMParser === 'undefined') {
    return []
  }

  const document = new DOMParser().parseFromString(html, 'text/html')
  return renderDomNodes(Array.from(document.body.childNodes), baseUrl, onNavigate)
}

function renderDomNodes(nodes: ChildNode[], baseUrl: string, onNavigate: (url: string) => void, parentTagName = ''): ReactNode[] {
  return nodes.map((node, index) => {
    return renderDomNode(node, baseUrl, onNavigate, index, parentTagName)
  })
}

function renderDomNode(node: ChildNode, baseUrl: string, onNavigate: (url: string) => void, index: number, parentTagName = ''): ReactNode {
  if (node.nodeType === 3) {
    if (noWhitespaceTextChildTags.includes(parentTagName) && !node.textContent?.trim()) {
      return null
    }
    return node.textContent
  }

  if (node.nodeType !== 1) {
    return null
  }

  const element = node as Element
  const tagName = element.tagName.toLowerCase()
  const children = renderDomNodes(Array.from(element.childNodes), baseUrl, onNavigate, tagName)

  if (skippedBrowserTags.includes(tagName)) {
    return null
  }

  if (tagName === 'html' || tagName === 'body') {
    return <Fragment key={index}>{children}</Fragment>
  }

  if (tagName === 'a') {
    const href = resolveBrowserUrl(element.getAttribute('href') || undefined, baseUrl)
    if (!href) {
      return <span key={index}>{children}</span>
    }

    return (
      <a
        key={index}
        href={href}
        title={textAttr(element.getAttribute('title') || undefined)}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault()
          onNavigate(href)
        }}
      >
        {children}
      </a>
    )
  }

  if (tagName === 'img') {
    const src = resolveBrowserUrl(element.getAttribute('src') || undefined, baseUrl)
    if (!src) {
      return null
    }

    return (
      <img
        key={index}
        src={src}
        alt={textAttr(element.getAttribute('alt') || undefined)}
        title={textAttr(element.getAttribute('title') || undefined)}
        width={textAttr(element.getAttribute('width') || undefined)}
        height={textAttr(element.getAttribute('height') || undefined)}
        loading="lazy"
        decoding="async"
      />
    )
  }

  if (voidBrowserTags.includes(tagName)) {
    const Tag = tagName as keyof JSX.IntrinsicElements
    return <Tag key={index} {...getDisplayProps(element, tagName, baseUrl)} />
  }

  if (nativeBrowserTags.includes(tagName)) {
    const Tag = tagName as keyof JSX.IntrinsicElements
    return <Tag key={index} {...getDisplayProps(element, tagName, baseUrl)}>{children}</Tag>
  }

  return <Fragment key={index}>{children}</Fragment>
}

export default function Browser() {
  const [html, setHtml] = useState('')
  const [address, setAddress] = useState(DEFAULT_URL)
  const [loadedUrl, setLoadedUrl] = useState('')
  const [browserError, setBrowserError] = useState('')
  const [navigation, setNavigation] = useState<NavigationState>({
    entries: [],
    index: -1,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [showAgentContext, setShowAgentContext] = useState(false)
  const agentContextRef = useRef<HTMLPreElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const didAutoLoadRef = useRef(false)

  const loadTargetUrl = useCallback(async (targetUrl: string, options: LoadOptions = {}) => {
    const historyMode = options.historyMode || 'push'
    abortControllerRef.current?.abort()

    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setBrowserError('')

    try {
      const response = await fetch(`/api/load?url=${encodeURIComponent(targetUrl)}`, {
        signal: controller.signal,
      })
      const data = await response.json() as LoadResponse

      if (!response.ok) {
        throw new Error(data.error || 'Could not load that URL.')
      }

      setHtml(data.html)
      setAddress(data.url)
      setLoadedUrl(data.url)
      setNavigation((current) => {
        if (historyMode === 'move') {
          const nextIndex = options.historyIndex
          if (typeof nextIndex !== 'number' || !current.entries[nextIndex]) {
            return current
          }

          const entries = current.entries.slice()
          entries[nextIndex] = data.url
          return { entries, index: nextIndex }
        }

        if (historyMode === 'replace') {
          const entries = current.entries.slice()
          const index = current.index > -1 ? current.index : 0
          entries[index] = data.url
          return { entries, index }
        }

        if (current.entries[current.index] === data.url) {
          return current
        }

        const entries = current.entries.slice(0, current.index + 1)
        entries.push(data.url)
        return { entries, index: entries.length - 1 }
      })
    } catch (error) {
      if (isAbortError(error)) {
        return
      }

      setHtml('')
      setBrowserError(getErrorMessage(error))
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
        setIsLoading(false)
      }
    }
  }, [])

  const navigateToUrl = useCallback((targetUrl: string) => {
    loadTargetUrl(targetUrl)
  }, [loadTargetUrl])

  useEffect(() => {
    if (didAutoLoadRef.current) {
      return
    }

    didAutoLoadRef.current = true
    loadTargetUrl(DEFAULT_URL, { historyMode: 'replace' })

    return () => abortControllerRef.current?.abort()
  }, [loadTargetUrl])

  const parsed = useMemo(() => {
    try {
      return {
        agentMarkdown: html ? htmlToMarkdown(html, { url: loadedUrl }) : '',
        content: renderBrowserContent(html, loadedUrl, navigateToUrl),
      }
    } catch (error) {
      return {
        agentMarkdown: '',
        content: <p className="error">Could not parse this HTML: {getErrorMessage(error)}</p>,
      }
    }
  }, [html, loadedUrl, navigateToUrl])

  async function loadUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      await loadTargetUrl(normalizeAddress(address, loadedUrl), {
        historyMode: isRefresh ? 'replace' : 'push',
      })
    } catch (error) {
      setHtml('')
      setBrowserError(getErrorMessage(error))
    }
  }

  function cancelLoad() {
    abortControllerRef.current?.abort()
  }

  function openBookmark(url: string) {
    if (isLoading) {
      return
    }

    loadTargetUrl(url)
  }

  function selectAgentContext() {
    const node = agentContextRef.current
    if (!node || typeof window === 'undefined') {
      return
    }

    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(node)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  function handleAgentKeyDown(event: React.KeyboardEvent<HTMLPreElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAgentContext()
    }
  }

  const trimmedAddress = address.trim()
  const isRefresh = Boolean(loadedUrl && trimmedAddress === loadedUrl)
  const actionLabel = isLoading ? 'Cancel load' : isRefresh ? 'Refresh page' : 'Load URL'
  const hasDimmedProtocol = address.toLowerCase().startsWith('https://')
  const canGoBack = navigation.index > 0
  const canGoForward = navigation.index > -1 && navigation.index < navigation.entries.length - 1

  function navigateHistory(step: number) {
    const nextIndex = navigation.index + step
    const targetUrl = navigation.entries[nextIndex]

    if (!targetUrl || isLoading) {
      return
    }

    loadTargetUrl(targetUrl, {
      historyIndex: nextIndex,
      historyMode: 'move',
    })
  }

  return (
    <>
      <div className="grid gap-3">
        <div>
          <h2 className="m-0 text-base font-black uppercase leading-tight">Browser</h2>
          <p className="m-0 mt-1 text-sm leading-tight text-[#555]">Parse and render html website.</p>
        </div>

        <section className="section-panel load-section">
          <div className="flex min-h-[34px] items-center border-b-[3px] border-[var(--ink)] bg-[var(--muted)] px-4 max-[760px]:min-h-8 max-[760px]:px-2.5">
            <div className="flex w-[52px] items-center gap-[7px] max-[760px]:w-12" aria-hidden="true">
              <span className="h-[11px] w-[11px] flex-none rounded-full border-2 border-[var(--ink)] bg-[var(--ink)]" />
              <span className="h-[11px] w-[11px] flex-none rounded-full border-2 border-[var(--ink)] bg-[var(--soft)]" />
              <span className="h-[11px] w-[11px] flex-none rounded-full border-2 border-[var(--ink)] bg-[var(--soft)]" />
            </div>
          </div>
          <form className="grid grid-cols-[auto_minmax(0,1fr)_46px] items-center gap-2.5 border-b-[3px] border-[var(--ink)] bg-[var(--panel)] p-4 max-[760px]:grid-cols-[auto_minmax(0,1fr)_44px] max-[760px]:gap-2 max-[760px]:p-2.5" onSubmit={loadUrl}>
          <div className="flex items-center gap-1.5 max-[760px]:gap-1">
            <button
              type="button"
              className="inline-flex h-[42px] w-[34px] cursor-pointer items-center justify-center rounded-none border-2 border-[var(--ink)] bg-[var(--panel)] text-2xl font-black leading-none text-[var(--ink)] [font:inherit] disabled:cursor-default disabled:opacity-[0.35] max-[760px]:w-[30px]"
              disabled={!canGoBack || isLoading}
              onClick={() => navigateHistory(-1)}
              aria-label="Back"
              title="Back"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className="inline-flex h-[42px] w-[34px] cursor-pointer items-center justify-center rounded-none border-2 border-[var(--ink)] bg-[var(--panel)] text-2xl font-black leading-none text-[var(--ink)] [font:inherit] disabled:cursor-default disabled:opacity-[0.35] max-[760px]:w-[30px]"
              disabled={!canGoForward || isLoading}
              onClick={() => navigateHistory(1)}
              aria-label="Forward"
              title="Forward"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <label className="sr-only" htmlFor="url">URL</label>
          <div className="relative min-w-0">
            {hasDimmedProtocol ? (
              <span className="pointer-events-none absolute bottom-0.5 left-3.5 top-0.5 z-[1] flex w-[8ch] items-center bg-white font-mono text-[16px] text-[#777]" aria-hidden="true">
                https://
              </span>
            ) : null}
            <input
              id="url"
              className={`min-h-[42px] w-full min-w-0 border-2 border-[var(--ink)] bg-white px-3 font-mono text-[16px] text-[var(--ink)] ${isLoading ? 'pr-10' : ''}`}
              type="text"
              inputMode="url"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="https://www.google.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            {isLoading ? (
              <span
                className="pointer-events-none absolute right-3 top-1/2 grid h-4 w-4 -translate-y-1/2 grid-cols-2 gap-0.5"
                aria-hidden="true"
              >
                <span className="h-[7px] w-[7px] animate-pulse bg-[#111] [animation-delay:0ms] [animation-duration:360ms]" />
                <span className="h-[7px] w-[7px] animate-pulse bg-[#555] [animation-delay:90ms] [animation-duration:360ms]" />
                <span className="h-[7px] w-[7px] animate-pulse bg-[#999] [animation-delay:270ms] [animation-duration:360ms]" />
                <span className="h-[7px] w-[7px] animate-pulse bg-[#d7d7d7] [animation-delay:180ms] [animation-duration:360ms]" />
              </span>
            ) : null}
          </div>
          <button
            className="min-h-[42px] min-w-[42px] cursor-pointer rounded-none border-2 border-[var(--ink)] bg-[var(--panel)] text-xl font-black leading-none text-[var(--ink)] shadow-[4px_4px_0_var(--ink)] [font:inherit] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_var(--ink)] disabled:cursor-wait disabled:opacity-[0.55]"
            type={isLoading ? 'button' : 'submit'}
            onClick={isLoading ? cancelLoad : undefined}
            aria-label={actionLabel}
            title={actionLabel}
          >
            <span aria-hidden="true">{isLoading ? '×' : isRefresh ? '↻' : '↵'}</span>
          </button>
          </form>

          <div className="flex min-h-10 items-center gap-2 border-b-[3px] border-[var(--ink)] bg-[var(--muted)] px-4 py-2 max-[760px]:px-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              {bookmarks.map((bookmark) => (
                <button
                  key={bookmark.url}
                  type="button"
                  className="inline-flex h-6 flex-none cursor-pointer items-center gap-1.5 rounded-none border-2 border-[var(--ink)] bg-[var(--panel)] px-1.5 font-mono text-[11px] font-black leading-none text-[var(--ink)] disabled:cursor-wait disabled:opacity-[0.45]"
                  disabled={isLoading}
                  onClick={() => openBookmark(bookmark.url)}
                  title={bookmark.url}
                  aria-label={`Open ${bookmark.label}`}
                >
                  <span className="inline-flex h-4 w-4 flex-none items-center justify-center border border-[var(--ink)] bg-[var(--ink)] font-mono text-[10px] font-black leading-none text-white" aria-hidden="true">
                    {bookmark.icon}
                  </span>
                  <span>{bookmark.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`inline-flex h-6 flex-none cursor-pointer items-center gap-1 rounded-none border-2 border-[var(--ink)] px-2 font-mono text-[11px] font-black uppercase leading-none ${showAgentContext ? 'bg-[var(--ink)] text-white' : 'bg-[var(--panel)] text-[var(--ink)]'}`}
              aria-pressed={showAgentContext}
              aria-controls="browser-agent"
              aria-label={`${showAgentContext ? 'Hide' : 'Show'} agent Markdown`}
              onClick={() => setShowAgentContext((value) => !value)}
            >
              <span>AGENT</span>
              <span aria-hidden="true">{showAgentContext ? '-' : '+'}</span>
            </button>
          </div>

          <div className="browser-viewport" aria-busy={isLoading}>
            <div className="rendered browser-content" data-preview-reset>
              {browserError ? <p className="error">{browserError}</p> : parsed.content}
            </div>
            <div id="browser-agent" className={`agent-context browser-agent-overlay ${showAgentContext ? 'is-visible' : ''}`} aria-hidden={!showAgentContext}>
              <pre
                ref={agentContextRef}
                tabIndex={showAgentContext ? 0 : -1}
                onKeyDown={handleAgentKeyDown}
              >
                {parsed.agentMarkdown || 'No agent context available.'}
              </pre>
            </div>
          </div>
        </section>
      </div>

    </>
  )
}
