import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  turbopack: {
    root: join(__dirname, '..'),
  },
}

export default nextConfig
