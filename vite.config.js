import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'renderer',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'renderer/index.html',
        settings: 'renderer/settings.html',
      },
    },
  },
  plugins: [react()],
})
