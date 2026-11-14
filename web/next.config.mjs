import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const nextConfig = {
  devIndicators: false,
  agentRules: false,
  // Next.js 16.3 has no agent-upgrade generation. When upgrading to a version
  // that supports it, disable it with experimental: { agentUpgrade: false }.
  turbopack: {
    root: join(__dirname, '..'),
  },
}

export default nextConfig
