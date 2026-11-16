import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // during `npm run dev`, API calls go to the local server started with `npm run dev:server`
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
