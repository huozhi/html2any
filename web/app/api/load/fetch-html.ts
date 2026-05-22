const MAX_BYTES = 500000

export class LoadUrlError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LoadUrlError'
    this.status = status
  }
}

export type FetchHtmlResult = {
  bytes: number
  html: string
  responseOk: boolean
  responseStatus: number
  truncated: boolean
  upstreamMitigation: string
  url: string
}

function normalizeUrl(value: string) {
  const trimmedUrl = value.trim()

  if (!trimmedUrl) {
    throw new LoadUrlError('URL is required.', 400)
  }

  if (/^https?:\/\//i.test(trimmedUrl)) {
    return new URL(trimmedUrl)
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmedUrl)) {
    throw new LoadUrlError('Only http and https URLs are supported.', 400)
  }

  if (trimmedUrl.startsWith('//')) {
    return new URL(`http:${trimmedUrl}`)
  }

  return new URL(`http://${trimmedUrl}`)
}

export async function fetchHtmlUrl(value: string | null): Promise<FetchHtmlResult> {
  if (!value) {
    throw new LoadUrlError('URL is required.', 400)
  }

  let url
  try {
    url = normalizeUrl(value)
  } catch (error) {
    if (error instanceof LoadUrlError) {
      throw error
    }

    throw new LoadUrlError('Enter a valid URL.', 400)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new LoadUrlError('Only http and https URLs are supported.', 400)
  }

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'html2any-docs/1.0',
      },
      signal: AbortSignal.timeout(10000),
    })

    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new LoadUrlError(`Expected HTML, received ${contentType}.`, 415)
    }

    const html = await response.text()
    const limitedHtml = html.slice(0, MAX_BYTES)

    return {
      html: limitedHtml,
      url: response.url || url.toString(),
      bytes: limitedHtml.length,
      responseOk: response.ok,
      responseStatus: response.status,
      truncated: html.length > MAX_BYTES,
      upstreamMitigation: response.headers.get('x-vercel-mitigated') || '',
    }
  } catch (error) {
    if (error instanceof LoadUrlError) {
      throw error
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new LoadUrlError('The request timed out.', 504)
    }

    throw new LoadUrlError('Could not fetch that URL.', 502)
  }
}
