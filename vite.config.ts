import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // En producción el juego vive en /NOMBRE-REPO/; en desarrollo sigue en /
  base: command === 'build' ? '/Simulacion1-ProyectoFinal/' : '/',
}));