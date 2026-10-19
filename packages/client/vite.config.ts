import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' lets the built site run from any sub-path (GitHub Pages etc.).
export default defineConfig({
  base: './',
  plugins: [preact()],
});
