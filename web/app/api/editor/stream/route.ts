import { fetchHtmlUrl, LoadUrlError } from '../../load/fetch-html'
import { SAMPLE_PAGE } from '../../../editor/sample-page'

export const dynamic = 'force-dynamic'

const MAX_HTML = 600000

type StreamRequest = {
  source?: 'sample' | 'html' | 'url'
  html?: string
  url?: string
  /** characters per second; 0 streams as fast as possible */
  cps?: number
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Stream text in token-sized chunks, roughly like an LLM response. */
function streamText(text: string, cps: number, signal: AbortSignal) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let i = 0
      let debt = 0
      while (i < text.length && !signal.aborted) {
        const size = 2 + Math.floor(Math.random() * 14)
        const chunk = text.slice(i, i + size)
        i += size
        controller.enqueue(encoder.encode(chunk))
        if (cps > 0) {
          debt += (chunk.length / cps) * 1000
          if (debt >= 16) {
            await sleep(debt)
            debt = 0
          }
        }
      }
      controller.close()
    },
  })
}

export async function POST(request: Request) {
  let body: StreamRequest
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 })
  }

  let html = SAMPLE_PAGE
  let baseUrl = ''
  if (body.source === 'html') {
    html = String(body.html || '').slice(0, MAX_HTML)
  } else if (body.source === 'url') {
    try {
      const result = await fetchHtmlUrl(body.url || '')
      html = result.html
      baseUrl = result.url
    } catch (error) {
      const status = error instanceof LoadUrlError ? error.status : 500
      const message = error instanceof LoadUrlError ? error.message : 'Could not fetch that URL.'
      return Response.json({ error: message }, { status })
    }
  }

  const cps = Math.max(0, Math.min(200000, Number(body.cps) || 0))
  return new Response(streamText(html, cps, request.signal), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-base-url': baseUrl,
    },
  })
}
