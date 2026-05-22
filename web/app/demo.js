"use client"

import { Fragment, useMemo, useState } from 'react'
import html2any, { parse } from '../../src/index.js'
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

function rule(node, children, index) {
  if (typeof node === 'string') {
    if (node.includes('html2any')) {
      const parts = node.split('html2any')
      const mergedParts = []
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

  const Tag = node.name
  const key = typeof node.index === 'number' ? node.index : undefined

  if (['head', 'script', 'style', 'meta', 'link', 'title', 'noscript'].includes(Tag)) {
    return null
  }

  if (Tag === 'html' || Tag === 'body') {
    return <Fragment key={key}>{children}</Fragment>
  }

  if (Tag === 'code') {
    if (Array.isArray(children) && typeof children[0] === 'string') {
      return <code key={key} className="code" dangerouslySetInnerHTML={{ __html: children }} />
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

function formatAttrValue(name, value) {
  if (value === true) {
    return 'true'
  }

  const text = String(value).replace(/\s+/g, ' ').trim()
  const limit = name === 'class' || name === 'className' ? 28 : 40

  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text
}

function collectAttrs(attrs) {
  return Object.entries(attrs)
    .slice(0, 4)
    .map(([name, value]) => ({
      name,
      value: formatAttrValue(name, value),
    }))
}

function collectTagRows(nodes, rows = [], depth = 0) {
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

function ParsedTags({ ast }) {
  const rows = collectTagRows(ast)

  return (
    <ol className="tag-list">
      {rows.map((row, index) => (
        <li key={`${row.tag}-${index}`} style={{ "--depth": row.depth }}>
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

export default function Demo() {
  const [html, setHtml] = useState(exampleHtml)
  const [urlPath, setUrlPath] = useState('huozhi.im')
  const [loadedUrl, setLoadedUrl] = useState('')
  const [status, setStatus] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const exampleContent = useMemo(() => html2any(exampleHtml, rule), [])
  const highlightedTransformerExample = useMemo(() => highlight(transformerExample), [])

  const parsed = useMemo(() => {
    try {
      const ast = parse(html)
      return {
        ast,
        content: html2any(html, rule),
      }
    } catch (error) {
      return {
        ast: [],
        content: <p className="error">Could not parse this HTML: {error.message}</p>,
      }
    }
  }, [html])

  async function loadUrl(event) {
    event.preventDefault()
    setIsLoading(true)
    setStatus('')

    try {
      const trimmedUrl = urlPath.trim()
      const targetUrl = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`
      const response = await fetch(`/api/load?url=${encodeURIComponent(targetUrl)}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Could not load that URL.')
      }

      setHtml(data.html)
      setLoadedUrl(data.url)
      setStatus(`Loaded ${data.bytes.toLocaleString()} bytes`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <section className="section-panel example-section">
        <h2 className="section-title">Example</h2>
        <div className="content-grid flex">
          <div className="flex-1 pad">
            <pre className="raw-code compact-code example-code">
              <code dangerouslySetInnerHTML={{ __html: highlightedTransformerExample }} />
            </pre>
          </div>

          <div className="flex-1 pad">
            <h4 className="label">Preview</h4>
            <div className="rendered compact-preview">{exampleContent}</div>
          </div>
        </div>
      </section>

      <section className="section-panel load-section">
        <form className="loader" onSubmit={loadUrl}>
          <label htmlFor="url">Load URL</label>
          <div className="url-control">
            <span>https://</span>
            <input
              id="url"
              type="text"
              value={urlPath}
              onChange={(event) => setUrlPath(event.target.value.replace(/^https?:\/\//i, ''))}
              placeholder="example.com"
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </div>
          <button type="submit" disabled={isLoading}>{isLoading ? 'Loading' : 'Load'}</button>
          {status ? <p className="status">{status}</p> : null}
        </form>

        {loadedUrl ? <div className="source-bar">{loadedUrl}</div> : null}

        <div className="content-grid flex">
          <div className="flex-1 pad">
            <h4 className="label">Parsed Tags</h4>
            <div className="parsed-tags">
              <ParsedTags ast={parsed.ast} />
            </div>
          </div>

          <div className="flex-1 pad">
            <h4 className="label">Preview</h4>
            <div className="rendered">{parsed.content}</div>
          </div>
        </div>
      </section>
    </>
  )
}
