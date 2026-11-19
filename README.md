# Mundo de bloques — Simulación 1 · Proyecto final

Juego 2D de bloques al estilo *Terraria*, hecho con **TypeScript**, **PixiJS** y **Vite** para la materia **Simulación I** de la **Universidad Nacional de Hurlingham**. El mundo se genera de forma procedural mientras exploras: superficie con ruido simplex, capas de tierra y piedra, cuevas con autómatas celulares y filones de minerales. Puedes minar, construir, pelear contra slimes y guardar tu progreso en el navegador.

**Demo:** <https://ivan-blc.github.io/Simulacion1-ProyectoFinal/>
## Características

- **Mundo procedural** generado por *chunks* de 32×32 bloques, sin límites fijos. La misma semilla produce siempre el mismo mundo.
- **Generación en Web Workers**, con vuelta automática al hilo principal si los workers no están disponibles.
- **Cuevas** con autómatas celulares y **minerales** (carbón, hierro y oro) según la profundidad.
- **Minar y construir** bloques con el ratón, con alcance limitado e inventario de 10 casillas.
- **Física propia**: colisiones con los bloques, salto variable, *coyote time* y escalones automáticos.
- **Enemigos** (slimes) que aparecen, te persiguen y te hacen daño al contacto.
- **Terreno suavizado**: los bordes se dibujan como curvas y diagonales (técnica tipo *marching squares*) en lugar de escalones, aunque la colisión y la edición siguen siendo por bloque.
- **Iluminación dinámica** con trazado de rayos: oscurece a medida que bajas, y el jugador, las antorchas y los enemigos interactúan con la luz y las sombras.
- **Antorchas y fabricación**: fabrícalas con carbón y colócalas en paredes o en el suelo para iluminar las cuevas.
- **Agua** simulada con un autómata celular por niveles: lagos en las depresiones del terreno que fluyen cuando minas, se nivelan, se guardan y se pueden cruzar nadando.
- **Audio procedural** (música y efectos generados con Web Audio, sin archivos de sonido).
- **Guardado automático**: los bloques y el agua que cambias se guardan en IndexedDB y el inventario en `localStorage`.

## Controles

| Acción | Control |
|---|---|
| Moverse | `A` / `D` o flechas izquierda / derecha |
| Saltar (en el agua, mantenlo para nadar hacia arriba) | `Espacio`, `W` o flecha arriba |
| Minar o atacar | Clic izquierdo (mantén pulsado y arrastra para minar varios bloques) |
| Construir o colocar antorcha | Clic derecho (las antorchas necesitan un bloque sólido a un lado o debajo) |
| Elegir casilla | `1`–`0`, o clic en la barra inferior |
| Fabricar antorchas | `C` (1 de carbón da 4 antorchas) |
| Zoom | Rueda del ratón (1× a 4×) |
| Pausa | `Esc` |
| Música | `M` |
| Iluminación | `L` |
| Suavizado de las sombras | `K` (alterna entre 0 y 3 pasadas) |
| Cámara libre | `F` (con `WASD` o flechas; `Shift` para ir más rápido) |
| Reaparecer en la superficie | `R` |
| Panel de depuración | `F3` |

Al abrir un mundo por primera vez recibes 20 antorchas (una sola vez por mundo).

> **Mundos guardados antes del agua:** las zonas que no habías editado se regeneran desde la semilla, así que aparecerán lagos en los valles. Tus cambios se conservan.

## Getting started

### Requisitos

- **Node.js 20.19 o superior** (o 22.12 o superior). Es el mínimo que pide Vite 8.
- npm (incluido con Node.js).
- Un navegador moderno con soporte de WebGL, Web Workers, IndexedDB y Web Audio.

### Instalar y ejecutar

```bash
git clone https://github.com/ivan-blc/Simulacion1-ProyectoFinal.git
cd Simulacion1-ProyectoFinal
npm install
npm run dev
```

Abre la dirección que muestre Vite en la terminal (normalmente `http://localhost:5173`). En la pantalla de título escribe una semilla (o pulsa **Semilla aleatoria**) y pulsa **Jugar**.


### Parámetros de la URL

Se añaden a la dirección, por ejemplo `http://localhost:5173/?autostart&seed=hola`.

| Parámetro | Efecto |
|---|---|
| `?seed=…` | Semilla del mundo. Un número se usa tal cual; cualquier otro texto se convierte en número |
| `?autostart` | Salta el menú y empieza directamente (semilla por defecto: `12345`) |
| `?reset` | Borra el mundo y el inventario guardados de esa semilla |
| `?noworker` | Genera el terreno en el hilo principal (para comparar rendimiento) |
| `?debug` | Muestra un mapa 2D de la generación en lugar del juego (el agua se ve en azul) |

## Estructura del proyecto

```
src/
├── main.ts          # arranque, bucle del juego y conexión de módulos
├── core/            # constantes, coordenadas, aleatoriedad, bloques y pool de objetos
├── world/           # chunks, generación, workers, persistencia, antorchas y simulación del agua
├── player/          # jugador, física y edición de bloques
├── entities/        # enemigos
├── items/           # inventario y fabricación
├── lighting/        # campo de luz (trazado de rayos) y mapa de oscuridad
├── render/          # chunks (terreno suavizado), agua, cámara, partículas, luz y texturas
├── ui/              # barra de acceso rápido, vida y menús
├── audio/           # música y efectos con Web Audio
└── dev/             # HUD, mapa de depuración y pruebas internas
```

## Tecnologías

| Paquete | Versión | Uso |
|---|---|---|
| [PixiJS](https://pixijs.com/) | ^8.22.0 | Render 2D |
| [simplex-noise](https://github.com/jwagner/simplex-noise.js) | ^4.0.3 | Ruido para la superficie y los minerales |
| [TypeScript](https://www.typescriptlang.org/) | ~7.0.2 | Lenguaje y comprobación de tipos |
| [Vite](https://vite.dev/) | ^8.3.5 | Servidor de desarrollo y empaquetado |


## Pruebas

Las pruebas internas están en [`src/dev/tests.ts`](src/dev/tests.ts). Se ejecutan automáticamente al cargar el juego con `npm run dev` y **no** se incluyen en la versión de producción. Los resultados aparecen en la consola del navegador (`F12`), con ✔ para las que pasan y ✘ para las que fallan.
