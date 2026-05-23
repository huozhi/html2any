import { Fragment } from 'react'
import type { JSX, ReactNode } from 'react'
import html2any from '../../src/index.js'
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

type HtmlNode = {
  index?: number
  name: string
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

export default function Usage() {
  return (
    <div className="grid gap-3">
      <div>
        <h2 className="m-0 text-base font-black uppercase leading-tight">Usage</h2>
        <p className="m-0 mt-1 text-sm leading-tight text-[#555]">Turn parsed HTML into the output shape you need.</p>
      </div>

      <section className="section-panel example-section">
        <div className="content-grid flex">
          <div className="flex-1 pad">
            <pre className="raw-code compact-code example-code">
              <code dangerouslySetInnerHTML={{ __html: highlight(transformerExample) }} />
            </pre>
          </div>

          <div className="flex-1 pad">
            <div className="rendered compact-preview" data-preview-reset>{html2any(exampleHtml, exampleRule)}</div>
          </div>
        </div>
      </section>
    </div>
  )
}
