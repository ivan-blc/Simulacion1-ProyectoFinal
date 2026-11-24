import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // En producción (build y preview) el juego vive en /Simulacion1-ProyectoFinal/; en desarrollo, en /
  base: mode === 'production' ? '/Simulacion1-ProyectoFinal/' : '/',
}));