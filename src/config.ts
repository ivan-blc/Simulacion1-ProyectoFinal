/**
 * Herramientas de desarrollo (panel F1 y mapa ?debug). Están disponibles también en la build pública.
 * Para quitarlas de una build: compilar con VITE_DEV_TOOLS=false.
 */
export const DEV_TOOLS: boolean = import.meta.env.VITE_DEV_TOOLS !== 'false';