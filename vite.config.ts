import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react(), crx({ manifest })],
  server: {
    cors: {
      origin: [/chrome-extension:\/\//],
    },
  },
})

