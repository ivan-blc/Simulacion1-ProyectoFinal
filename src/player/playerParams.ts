export const PLAYER = {
  WIDTH: 12,            // cabe en un hueco de 1 bloque de ancho
  HEIGHT: 28,           // cabe en un túnel de 2 bloques de alto

  MOVE_SPEED: 160,      // px/s (10 bloques/s)
  GROUND_ACCEL: 1600,   // px/s² en suelo
  AIR_ACCEL: 1000,      // px/s² en el aire

  GRAVITY: 1800,        // px/s²
  MAX_FALL: 900,        // velocidad máxima de caída (px/s)
  JUMP_SPEED: 540,      // salto de ~5 bloques de alto
  JUMP_CUT: 0.5,        // al soltar el salto, la subida se corta a la mitad
  COYOTE_TIME: 0.1,     // s de margen para saltar tras salir de un borde
  JUMP_BUFFER: 0.1,     // s de margen para saltar justo antes de aterrizar

  AUTO_STEP: true,      // sube solo los escalones de 1 bloque
  REACH_BLOCKS: 6,      // alcance de minado y construcción

  SUBSTEP: 1 / 120,     // la física avanza en pasos de 1/120 s como máximo
  MAX_DT: 1 / 30,       // un frame nunca simula más de 1/30 s (pestaña en segundo plano)
  MAX_STEP_PX: 8,       // desplazamiento máximo por iteración (menor que un bloque)
} as const;