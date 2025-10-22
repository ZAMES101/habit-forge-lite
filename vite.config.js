import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// This configuration tells Vite how to handle React and JSX files.
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
})
