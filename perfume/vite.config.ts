import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Three applications, one backend: owner/admin app, business-manager app, staff mobile app.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        manager: resolve(__dirname, 'manager.html'),
        staff: resolve(__dirname, 'staff.html'),
      },
    },
  },
  server: { proxy: { '/api': 'http://localhost:8790' } },
})
