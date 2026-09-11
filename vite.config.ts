import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'src/demo',
  plugins: [vue()],
  build: { outDir: '../../dist-demo', emptyOutDir: true },
});
