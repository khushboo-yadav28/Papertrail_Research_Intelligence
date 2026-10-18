import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.RESEARCH_API_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
        configure(proxy) {
          proxy.on('error', (error) => {
            console.error(`[vite proxy] Paper API unavailable at ${process.env.RESEARCH_API_URL || 'http://127.0.0.1:8000'}: ${error.message}`);
          });
        }
      }
    }
  },
  build: {
    outDir: '..',
    emptyOutDir: false,
    assetsDir: 'assets'
  }
});
