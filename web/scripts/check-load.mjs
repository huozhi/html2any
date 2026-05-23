const targetUrl = process.argv[2]
const devServer = process.env.HTML2ANY_DEV_URL || 'http://localhost:3000'

function normalizeTargetUrl(value) {
  const trimmedUrl = value.trim()

  if (/^https?:\/\//i.test(trimmedUrl)) {
    return new URL(trimmedUrl).toString()
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmedUrl)) {
    throw new Error('Only http and https URLs are supported.')
  }

  if (trimmedUrl.startsWith('//')) {
    return new URL(`http:${trimmedUrl}`).toString()
  }

  return new URL(`http://${trimmedUrl}`).toString()
}

if (!targetUrl) {
  console.error('Usage: bun run web:check-load <url>')
  process.exit(1)
}

let normalizedTargetUrl
try {
  normalizedTargetUrl = normalizeTargetUrl(targetUrl)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

const endpoint = new URL('/api/agent/load-check', devServer)
endpoint.searchParams.set('url', normalizedTargetUrl)

const response = await fetch(endpoint)
const data = await response.json()

if (!response.ok || !data.ok) {
  console.error(data.error || `Load check failed with ${response.status}.`)
  process.exit(1)
}

const title = data.parsed.title ? ` title="${data.parsed.title}"` : ''
const status = data.responseStatus && data.responseStatus !== 200 ? ` status=${data.responseStatus}` : ''
const mitigation = data.upstreamMitigation ? ` mitigation=${data.upstreamMitigation}` : ''
console.log(`ok ${data.url}${status}${mitigation} tags=${data.parsed.tagCount} links=${data.parsed.links} images=${data.parsed.images}${title}`)
