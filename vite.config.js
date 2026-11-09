const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');
const path = require('node:path');

module.exports = defineConfig(({ command }) => ({
  root: path.resolve(__dirname, 'client'),
  base: command === 'serve' ? '/' : '/app/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/images': 'http://localhost:3000',
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'public/app'),
    emptyOutDir: true,
  },
}));
