/** PRNG con semilla (mulberry32): devuelve números en [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash determinista de (x, y, seed) -> [0, 1).
 * No depende del orden de llamada: es la clave para que las cuevas
 * coincidan entre chunks vecinos.
 */
export function hash2D(x: number, y: number, seed: number): number {
  let h =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(seed | 0, 1274126177)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Convierte el texto de una semilla en un entero de 32 bits.
 * Los números se respetan tal cual (la semilla 12345 sigue siendo 12345);
 * cualquier otro texto se convierte con un hash FNV-1a determinista.
 */
export function seedFromText(text: string | null, fallback: number): number {
  const t = (text ?? '').trim();
  if (t === '') return fallback;
  if (/^-?\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n)) return n | 0;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}