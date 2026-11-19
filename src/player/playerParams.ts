export const PLAYER = {
  WIDTH: 10,            // cabe en un hueco de 1 bloque de ancho - original 12
  HEIGHT: 18,           // cabe en un túnel de 2 bloques de alto - original 28

  MOVE_SPEED: 160,      // px/s (10 bloques/s)
  GROUND_ACCEL: 1600,   // px/s² en suelo
  AIR_ACCEL: 1000,      // px/s² en el aire

  GRAVITY: 1800,        // px/s²
  MAX_FALL: 900,        // velocidad máxima de caída (px/s)
  JUMP_SPEED: 540,      // salto de ~5 bloques de alto
  JUMP_CUT: 0.5,        // al soltar el salto, la subida se corta a la mitad
  COYOTE_TIME: 0.1,     // s de margen para saltar tras salir de un borde
  JUMP_BUFFER: 0.1,     // s de margen para saltar justo antes de aterrizar

  // Nadar (ver docs/IMPLEMENTACION_AGUA.md)
  SWIM_THRESHOLD: 0.5,  // fracción del cuerpo bajo el agua a partir de la cual nada
  SWIM_MIN_LEVEL: 0.4,  // nivel de agua de una celda (0..1) para contar como "agua" al muestrear
  SWIM_GRAVITY: 450,    // px/s² dentro del agua
  SWIM_MAX_FALL: 140,   // velocidad máxima de caída en el agua (px/s)
  SWIM_UP: 170,         // velocidad de ascenso al mantener saltar (px/s)
  SWIM_ACCEL: 1200,     // px/s² para alcanzar SWIM_UP
  SWIM_MOVE_MUL: 0.7,   // multiplicador de la velocidad horizontal
  SWIM_DRAG: 3,         // rozamiento vertical por segundo
  SWIM_EXIT_JUMP: 0.8,  // fracción del salto normal al salir del agua (con la cabeza fuera)

  AUTO_STEP: true,      // sube solo los escalones de 1 bloque
  REACH_BLOCKS: 6,      // alcance de minado y construcción

  SUBSTEP: 1 / 120,     // la física avanza en pasos de 1/120 s como máximo
  MAX_DT: 1 / 30,       // un frame nunca simula más de 1/30 s (pestaña en segundo plano)
  MAX_STEP_PX: 8,       // desplazamiento máximo por iteración (menor que un bloque)

  MAX_HEALTH: 100,
  INVULN_TIME: 1,       // s de invulnerabilidad tras recibir un golpe
  KNOCKBACK_X: 220,     // retroceso al recibir daño (px/s)
  KNOCKBACK_Y: 250,
} as const;