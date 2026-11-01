import { Application, Sprite } from 'pixi.js';
import { BLOCK_SIZE, BlockId } from './core/constants';
import { createBlockTextures } from './render/atlas';
import { runPhase1Tests } from './dev/tests';

async function main() {
  runPhase1Tests();
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#6ec0ff',
    antialias: false,
    roundPixels: true,
  });
  document.body.appendChild(app.canvas);

  const textures = createBlockTextures();

  // Sprite de prueba: una fila con todos los tipos de bloque, a 4x de zoom
  const ids = [BlockId.DIRT, BlockId.STONE, BlockId.GRASS];
  ids.forEach((id, i) => {
    const s = new Sprite(textures[id]);
    s.scale.set(4);
    s.position.set(100 + i * BLOCK_SIZE * 4, 100);
    app.stage.addChild(s);
  });
}

main();
