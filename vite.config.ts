import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), tailwindcss(), ...(command === 'serve' && mode === 'r5-prototype' ? [{
    name: 'r5-prototype-entry',
    transformIndexHtml: (html: string) => html.replace('/src/web/main.tsx', '/src/web/r5-prototype-entry.tsx'),
  }] : [])],
  build: { outDir: 'dist' },
}))
