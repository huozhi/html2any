import Head from 'next/head'
import html2any from 'html2any'

function decodeHtmlEntity(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

function encodeHtmlEntity(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

const html = `
<div>
  <h1>Getting Started</h1>
  <p>Welcome to html2any documentation!</p>

  <h3>Install</h3>
  <p>html2any is a dependency free library can be used in any JS runtime.</p>
  <pre><code>npm install --save html2any</code></pre>

  <h3>Usage</h3>

  <pre><code>${encodeHtmlEntity(`
import html2any, { parse, transform } from 'html2any'

const html = \`<div>123</div>\`

const ast = parse(html)[0]

function rule(node, children) {
  if (node.name === 'div') {
    return React.createElement(node.name. null, children)
  } else {
    return node // string
  }
}

const vdom = transform(ast, rule)
// jsx vdom form of html
// { type: 'div', props: {...}, children: '...' }
`)}

// render it as react
ReactDOM.render(vdom, document.getElementById('root'))
    </code>
  </pre>  
</div>
`

function rule(node, children) {
  if (typeof node === 'string') {
    return node
  }

  const Tag = node.name
  if (Tag === 'code') {
    return <code className='code' dangerouslySetInnerHTML={{ __html: children }} />
  } else if (Tag === 'pre') {
    return <Tag className='pre'>{children}</Tag>
  } else if (['h1', 'h2', 'h3'].includes(Tag)) {
    return <Tag className='title'>{children}</Tag>
  } else {
    return <Tag>{children}</Tag>
  }
}

function Page() {
  const content = html2any(html, rule)

  return (
    <div>
      <Head>
        <title>html2any</title>
      </Head>

      <h1>html2any</h1>

      <div className='flex'>
        <div className='flex-1'>
          <h4 className='label'>Raw HTML</h4>
          <div>
            <pre className='raw-code'>
              <code>
                {decodeHtmlEntity(html)}
              </code>
            </pre>
          </div>
        </div>

        <div className='flex-1'>
          <h4 className='label'>Transformed HTML</h4>
          <div>{content}</div>
        </div>

      </div>
    </div>
  )
}

export default Page
