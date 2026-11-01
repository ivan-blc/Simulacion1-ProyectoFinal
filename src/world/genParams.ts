export const GEN = {
  // Superficie
  SURFACE_BASE: 64,        // altura media (en bloques; Y crece hacia abajo)
  SURFACE_AMPLITUDE: 18,   // la superficie varía en base ± amplitud
  SURFACE_FREQ: 0.008,     // menor = colinas más anchas
  SURFACE_OCTAVES: 3,

  // Capas
  DIRT_MIN: 4,             // grosor mínimo de tierra bajo el pasto
  DIRT_VARIATION: 4,       // + 0..4 bloques extra por columna

  // Cuevas
  CAVE_ITERATIONS: 4,
  CAVE_PAD: 4,             // DEBE ser >= CAVE_ITERATIONS (evita costuras)
  CAVE_SOLID_CHANCE: 0.48, // densidad inicial de sólidos (sube = menos cuevas)
  CAVE_MIN_DEPTH: 12,      // por encima de esta profundidad nunca hay cuevas
  CAVE_RAMP: 16,           // bloques para pasar de "sin cuevas" a densidad plena
} as const;