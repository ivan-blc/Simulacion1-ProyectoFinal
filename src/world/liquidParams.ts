/** Parámetros de la simulación de agua (ver docs/IMPLEMENTACION_AGUA.md). */
export const LIQUID = {
  MAX_LEVEL: 1024, // celda llena (los niveles se guardan en un Uint16Array)
  MIN_DIFF: 2, // diferencia mínima para repartir hacia un lado (evita rebotes)
  EVAPORATE_LEVEL: 2, // una capa así de fina sobre suelo sólido desaparece (0 = desactivado)
  TICK_HZ: 20, // pasos de simulación por segundo
  SUBSTEPS: 1, // pasadas por tick (súbelo para que el agua reaccione más rápido)
  MAX_TICKS_PER_FRAME: 2, // evita "espirales" si un fotograma tarda mucho
  CELL_BUDGET: 6000, // celdas procesadas por tick como máximo
  FALL_CAP: 256, // agua máxima que pasa de una celda a la de abajo por tick: estira un grumo en un chorro
  LIGHT_ABSORPTION: 0.12, // fracción de luz que absorbe una celda llena de agua
} as const;
