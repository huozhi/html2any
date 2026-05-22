import { parse } from '../../../../../src/index.js'
import { fetchHtmlUrl, LoadUrlError } from '../../load/fetch-html'

type AttrValue = string | boolean
type HtmlNode = {
  attributes?: Record<string, AttrValue | undefined>
  children?: HtmlTree
  name: string
}
type HtmlTree = Array<HtmlNode | string>
type ParsedSummary = {
  images: number
  links: number
  tagCount: number
  title: string
}

function textFrom(children: HtmlTree | undefined): string {
  if (!Array.isArray(children)) {
    return ''
  }

  return children.map((child) => {
    if (typeof child === 'string') {
      return child
    }

    return textFrom(child.children)
  }).join(' ')
}

function inspect(nodes: HtmlTree | undefined, summary: ParsedSummary = {
  images: 0,
  links: 0,
  tagCount: 0,
  title: '',
}) {
  if (!Array.isArray(nodes)) {
    return summary
  }

  for (const node of nodes) {
    if (typeof node === 'string') {
      continue
    }

    summary.tagCount++

    const tagName = node.name.toLowerCase()
    const attrs = node.attributes || {}

    if (tagName === 'a' && typeof attrs.href === 'string') {
      summary.links++
    }

    if (tagName === 'img' && typeof attrs.src === 'string') {
      summary.images++
    }

    if (tagName === 'title' && !summary.title) {
      summary.title = textFrom(node.children).replace(/\s+/g, ' ').trim()
    }

    inspect(node.children, summary)
  }

  return summary
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const value = searchParams.get('url')

  try {
    const result = await fetchHtmlUrl(value)
    const ast = parse(result.html) as HtmlTree
    const summary = inspect(ast)

    return Response.json({
      ok: true,
      url: result.url,
      responseOk: result.responseOk,
      responseStatus: result.responseStatus,
      truncated: result.truncated,
      upstreamMitigation: result.upstreamMitigation,
      parsed: summary,
    })
  } catch (error) {
    if (error instanceof LoadUrlError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status })
    }

    return Response.json({ ok: false, error: 'Could not verify that URL.' }, { status: 500 })
  }
}
