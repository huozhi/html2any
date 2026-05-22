'use client'

import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, JSX, MouseEvent, ReactNode } from 'react'
import html2any, { parse, transform } from '../../src/index.js'
import { highlight } from 'sugar-high'

const github = `https://github.com/huozhi/html2any`

const exampleHtml =
`<div>
  <h1>Getting Started</h1>
  <p>Welcome to html2any documentation!</p>
  <h3>Install</h3>
  <p>html2any is a dependency free library can be used in any JS runtime.</p>
  <pre><code>npm install --save html2any</code></pre>
  <h3>Usage</h3>
  <p>Map each parsed node to whatever output shape your app needs.</p>
</div>
`

const transformerExample =
`import html2any from 'html2any'

const html = \`${exampleHtml.trim()}\`

function rule(node, children, index) {
  if (typeof node === 'string') {
    return node
  }
  const Tag = node.name
  const key = typeof node.index === 'number' ? node.index : undefined
  if (['h1', 'h2', 'h3'].includes(Tag)) {
    return <Tag key={key} className="title">{children}</Tag>
  }
  if (Tag === 'pre') {
    return <pre key={key} className="pre">{children}</pre>
  }
  return <Tag key={key}>{children}</Tag>
}

const content = html2any(html, rule)`

type AttrValue = string | boolean
type Attributes = Record<string, AttrValue | undefined>
type HtmlNode = {
  attributes?: Attributes
  children?: HtmlTree
  index?: number
  name: string
}
type HtmlTree = Array<HtmlNode | string>
type BrowserRule = (node: HtmlNode | string, children?: ReactNode, index?: number) => ReactNode
type TagAttr = {
  name: string
  value: string
}
type TagRow = {
  attrs: TagAttr[]
  depth: number
  tag: string
}
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function exampleRule(node: HtmlNode | string, children?: ReactNode, index?: number): ReactNode {
  if (typeof node === 'string') {
    if (node.includes('html2any')) {
      const parts = node.split('html2any')
      const mergedParts: ReactNode[] = []
      for (let i = 0; i < parts.length; i++) {
        mergedParts.push(<span key={`text-${i}`} dangerouslySetInnerHTML={{ __html: parts[i] }} />)
        if (i < parts.length - 1) {
          mergedParts.push(<a key={`link-${i}`} target="_blank" rel="noreferrer" href={github}><b>html2any</b></a>)
        }
      }

      return <span key={index}>{mergedParts}</span>
    }
    return node
  }

  const Tag = node.name as keyof JSX.IntrinsicElements
  const key = typeof node.index === 'number' ? node.index : undefined

  if (['head', 'script', 'style', 'meta', 'link', 'title', 'noscript'].includes(Tag)) {
    return null
  }

  if (Tag === 'html' || Tag === 'body') {
    return <Fragment key={key}>{children}</Fragment>
  }

  if (Tag === 'code') {
    if (Array.isArray(children) && typeof children[0] === 'string') {
      return <code key={key} className="code" dangerouslySetInnerHTML={{ __html: children.join('') }} />
    }
    return <code key={key} className="code">{children}</code>
  } else if (Tag === 'pre') {
    return <Tag key={key} className="pre">{children}</Tag>
  } else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(Tag)) {
    return <Tag key={key} className="title">{children}</Tag>
  } else if (['main', 'article', 'section', 'nav', 'header', 'footer', 'aside'].includes(Tag)) {
    return <div key={key}>{children}</div>
  } else if (Tag === 'p') {
    return <div key={key} className="paragraph">{children}</div>
  } else if (['div', 'ul', 'ol', 'li', 'a', 'b', 'strong', 'em', 'span', 'br'].includes(Tag)) {
    return <Tag key={key}>{children}</Tag>
  }

  return <div key={key}>{children}</div>
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

function createBrowserRule(baseUrl: string, onNavigate: (url: string) => void): BrowserRule {
  return function browserRule(node, children, index) {
    if (typeof node === 'string') {
      return node
    }

    const tagName = node.name.toLowerCase()
    const attrs = node.attributes || {}
    const key = typeof node.index === 'number' ? node.index : index

    if (['head', 'script', 'style', 'meta', 'link', 'title', 'noscript', 'template'].includes(tagName)) {
      return null
    }

    if (tagName === 'html' || tagName === 'body') {
      return <Fragment key={key}>{children}</Fragment>
    }

    if (tagName === 'a') {
      const href = resolveBrowserUrl(attrs.href, baseUrl)
      if (!href) {
        return <span key={key}>{children}</span>
      }

      return (
        <a
          key={key}
          href={href}
          title={textAttr(attrs.title)}
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
      const src = resolveBrowserUrl(attrs.src, baseUrl)
      if (!src) {
        return null
      }

      return (
        <img
          key={key}
          src={src}
          alt={textAttr(attrs.alt)}
          title={textAttr(attrs.title)}
          loading="lazy"
          decoding="async"
        />
      )
    }

    if (['main', 'article', 'section', 'nav', 'header', 'footer', 'aside', 'form'].includes(tagName)) {
      return <div key={key}>{children}</div>
    }

    if (tagName === 'p') {
      return <div key={key} className="paragraph">{children}</div>
    }

    if (tagName === 'br' || tagName === 'hr') {
      const Tag = tagName as keyof JSX.IntrinsicElements
      return <Tag key={key} />
    }

    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      const Tag = tagName as keyof JSX.IntrinsicElements
      return <Tag key={key} className="title">{children}</Tag>
    }

    if (tagName === 'code') {
      return <code key={key} className="code">{children}</code>
    }

    if (tagName === 'pre') {
      return <pre key={key} className="pre">{children}</pre>
    }

    if (
      [
        'div',
        'ul',
        'ol',
        'li',
        'b',
        'strong',
        'em',
        'i',
        'span',
        'small',
        'blockquote',
        'table',
        'thead',
        'tbody',
        'tfoot',
        'tr',
        'th',
        'td',
        'dl',
        'dt',
        'dd',
      ].includes(tagName)
    ) {
      const Tag = tagName as keyof JSX.IntrinsicElements
      return <Tag key={key}>{children}</Tag>
    }

    return <div key={key}>{children}</div>
  }
}

function formatAttrValue(name: string, value: AttrValue | undefined) {
  if (value === true) {
    return 'true'
  }

  const text = String(value).replace(/\s+/g, ' ').trim()
  const limit = name === 'class' || name === 'className' ? 28 : 40

  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text
}

function collectAttrs(attrs: Attributes): TagAttr[] {
  return Object.entries(attrs)
    .slice(0, 4)
    .map(([name, value]) => ({
      name,
      value: formatAttrValue(name, value),
    }))
}

function collectTagRows(nodes: HtmlTree | undefined, rows: TagRow[] = [], depth = 0): TagRow[] {
  if (!Array.isArray(nodes)) {
    return rows
  }

  for (const node of nodes) {
    if (rows.length >= 80) {
      break
    }

    if (typeof node === 'string') {
      continue
    }

    const attrs = node.attributes || {}
    rows.push({
      attrs: collectAttrs(attrs),
      depth,
      tag: node.name,
    })

    collectTagRows(node.children, rows, depth + 1)
  }

  return rows
}

function ParsedTags({ ast }: { ast: HtmlTree }) {
  const rows = collectTagRows(ast)

  return (
    <ol className="tag-list">
      {rows.map((row, index) => (
        <li key={`${row.tag}-${index}`} style={{ '--depth': row.depth } as CSSProperties}>
          <span>- </span>
          <strong>{row.tag}</strong>
          {row.attrs.map((attr) => (
            <span className="tag-attr" key={attr.name}> {attr.name}={attr.value}</span>
          ))}
        </li>
      ))}
    </ol>
  )
}

export default function Browser() {
  const [html, setHtml] = useState('')
  const [address, setAddress] = useState('http://huozhi.im')
  const [loadedUrl, setLoadedUrl] = useState('')
  const [browserError, setBrowserError] = useState('')
  const [navigation, setNavigation] = useState<NavigationState>({
    entries: [],
    index: -1,
  })
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const exampleContent = useMemo(() => html2any(exampleHtml, exampleRule), [])
  const highlightedTransformerExample = useMemo(() => highlight(transformerExample), [])

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

  const browserRule = useMemo(() => createBrowserRule(loadedUrl, navigateToUrl), [loadedUrl, navigateToUrl])

  const parsed = useMemo(() => {
    try {
      const ast = parse(html)
      return {
        ast: ast as HtmlTree,
        content: transform(ast, browserRule) as ReactNode,
      }
    } catch (error) {
      return {
        ast: [],
        content: <p className="error">Could not parse this HTML: {getErrorMessage(error)}</p>,
      }
    }
  }, [browserRule, html])

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
          <p className="m-0 mt-1 text-sm leading-tight text-[#555]">See what can it do...</p>
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
              placeholder="http://example.com"
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

          <div className="browser-viewport" aria-busy={isLoading}>
            <div className="rendered browser-content">
              {browserError ? <p className="error">{browserError}</p> : parsed.content}
            </div>
          </div>

          <details className="tag-details">
            <summary>Parsed Tags</summary>
            <div className="parsed-tags">
              <ParsedTags ast={parsed.ast} />
            </div>
          </details>
        </section>
      </div>

      <div className="grid gap-3">
        <div>
          <h2 className="m-0 text-base font-black uppercase leading-tight">Usage</h2>
          <p className="m-0 mt-1 text-sm leading-tight text-[#555]">Turn parsed HTML into the output shape you need.</p>
        </div>

        <section className="section-panel example-section">
          <div className="content-grid flex">
            <div className="flex-1 pad">
              <pre className="raw-code compact-code example-code">
                <code dangerouslySetInnerHTML={{ __html: highlightedTransformerExample }} />
              </pre>
            </div>

            <div className="flex-1 pad">
              <div className="rendered compact-preview">{exampleContent}</div>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
