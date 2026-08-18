import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: [
      '.iss-ruidong.com',
      '.agentsphere.run'
    ],
    proxy: {
      '/cover-search': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      },
      '/cover-img': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: [
      '.iss-ruidong.com',
      '.agentsphere.run'
    ],
    proxy: {
      '/cover-search': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      },
      '/cover-img': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  }
})
