import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 5 * 1024 * 1024

/** The editor app's own dist folder (web/dist), not the library build output. */
function outputDir() {
  if (process.env.HTML2ANY_EDITOR_OUT) return path.resolve(process.env.HTML2ANY_EDITOR_OUT)
  const cwd = process.cwd()
  const webDir = existsSync(path.join(cwd, 'web', 'next.config.mjs')) ? path.join(cwd, 'web') : cwd
  return path.join(webDir, 'dist')
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && !process.env.HTML2ANY_EDITOR_OUT) {
    return Response.json({ error: 'Writing to disk is only enabled in development.' }, { status: 403 })
  }

  let html = ''
  try {
    const body = await request.json()
    html = String(body.html || '')
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 })
  }
  if (!html || html.length > MAX_BYTES) {
    return Response.json({ error: 'Nothing to export.' }, { status: 400 })
  }

  const dir = outputDir()
  const file = path.join(dir, 'index.html')
  await mkdir(dir, { recursive: true })
  await writeFile(file, html, 'utf8')
  return Response.json({ file: path.relative(process.cwd(), file) || file, bytes: Buffer.byteLength(html) })
}
