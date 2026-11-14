import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

const schema = fileURLToPath(new URL('../../crates/katana-core/schema/katana-gen3.json', import.meta.url))

export default defineConfig({
  plugins: [svelte()],
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC') },
  resolve: { alias: { '$schema': schema } },
  server: { port: 5174, strictPort: true, fs: { allow: ['..', '../../crates/katana-core/schema'] } },
  build: { target: 'chrome110', chunkSizeWarningLimit: 2000 },
})
