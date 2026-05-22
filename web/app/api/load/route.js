const MAX_BYTES = 500000

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const value = searchParams.get('url')

  if (!value) {
    return Response.json({ error: 'URL is required.' }, { status: 400 })
  }

  let url
  try {
    url = new URL(value)
  } catch {
    return Response.json({ error: 'Enter a valid URL.' }, { status: 400 })
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return Response.json({ error: 'Only http and https URLs are supported.' }, { status: 400 })
  }

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'html2any-docs/1.0',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return Response.json({ error: `Request failed with ${response.status}.` }, { status: 502 })
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return Response.json({ error: `Expected HTML, received ${contentType}.` }, { status: 415 })
    }

    const html = await response.text()
    const limitedHtml = html.slice(0, MAX_BYTES)

    return Response.json({
      html: limitedHtml,
      url: url.toString(),
      bytes: limitedHtml.length,
      truncated: html.length > MAX_BYTES,
    })
  } catch (error) {
    if (error.name === 'TimeoutError') {
      return Response.json({ error: 'The request timed out.' }, { status: 504 })
    }

    return Response.json({ error: 'Could not fetch that URL.' }, { status: 502 })
  }
}
