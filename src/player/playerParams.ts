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

export const LIQUID = {
  WATER_SLOW: 0.6, // factor de velocidad horizontal en el agua
  WATER_FRACTION: 0.3, // fracción del cuerpo cubierta de agua para considerarlo sumergido
  LAVA_SLOW: 0.45,
  GRAVITY_MULT: 0.3, // gravedad dentro de un líquido
  MAX_FALL: 130, // velocidad máxima de caída dentro de un líquido (px/s)
  SWIM_ACCEL: 2200, // aceleración al nadar hacia arriba (manteniendo el salto)
  SWIM_UP: 170, // velocidad máxima de ascenso en el agua
  LAVA_SWIM_UP: 90,
  LAVA_DPS: 30, // daño por segundo en la lava
  LAVA_TOUCH: 0.06, // fracción cubierta de lava para quemarse
} as const;