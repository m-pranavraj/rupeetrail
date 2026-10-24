import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      // The API Worker runs on 8787 during development; the browser only ever
      // talks to the dev origin, so tokens never leave a same-origin request.
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      // Local realtime helper (freebuff-realtime/wrangler.jsonc) on 8788. The
      // helper speaks the same path the hosted dispatcher uses, so the browser
      // code needs no special case beyond pointing the local host here.
      '/.well-known/freebuff/realtime': {
        target: 'http://127.0.0.1:8788',
        ws: true,
        changeOrigin: false,
      },
    },
  },
})
