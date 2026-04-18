/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Backend URL para el proxy — lee VITE_API_BASE_URL o usa el default local
  // Ejemplo: http://127.0.0.1:8080
  const apiBase = (env.VITE_API_BASE_URL || 'http://127.0.0.1:8080/api')
    .replace(/\/api\/?$/, '')

  const wsBase = env.VITE_WS_BASE_URL
    ? `ws://${env.VITE_WS_BASE_URL}`
    : `ws://127.0.0.1:8080`

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],

    server: {
      // El proxy elimina los errores CORS en dev: el browser hace requests
      // a localhost:5173/api y Vite los reenvía al backend internamente.
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
        },
        '/ws': {
          target: wsBase,
          ws: true,
          changeOrigin: true,
        },
      },
    },

    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined
            }
            if (id.includes('@codemirror') || id.includes('@uiw/react-codemirror')) {
              return 'codemirror'
            }
            if (id.includes('xterm')) {
              return 'xterm'
            }
            return undefined
          },
        },
      },
    },

    test: {
      globals: true,
      environment: 'happy-dom',
      setupFiles: './src/setupTests.ts',
    },
  }
})
