// Capturas de la fase 1 (proyecto, lienzo, capas) en 1280 y 390 px.
// Uso: npm run build && node tools/capturas-fase1.mjs
// Comprueba además que no haya desbordamiento horizontal.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const SALIDA = join(RAIZ, 'capturas', 'fase-1');
const MUESTRAS = join(RAIZ, 'tests', 'muestras');
mkdirSync(SALIDA, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
function servir(dir) {
  const s = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = join(dir, p);
    if (!f.startsWith(dir) || !existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
    res.end(readFileSync(f));
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, url: `http://127.0.0.1:${s.address().port}/` })));
}

// Perfil y material de PRUEBA (no son los valores de la máquina de Angel ni ajustes reales).
const PERFIL = { nombre: 'Láser de prueba', sMax: '1000', laserMode32: '1', origen: 'inferior-izquierda', camaAncho: '400', camaAlto: '400' };

const navegador = await chromium.launch();
const problemas = [];
async function foto(page, nombre, selector = '#proyecto') {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (desborde > 0) problemas.push(`${nombre}: desborda ${desborde}px en horizontal`);
  await page.locator(selector).screenshot({ path: join(SALIDA, nombre) });
  console.log('captura', join('capturas/fase-1', nombre));
}

const app = await servir(join(RAIZ, 'dist'));
for (const ancho of [1280, 390]) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: ancho > 600 ? 800 : 844 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(app.url);
  await p.evaluate((perfil) => {
    localStorage.clear();
    localStorage.setItem('chopilaser.perfiles.v1', JSON.stringify({ activo: 0, perfiles: [perfil] }));
  }, PERFIL);
  await p.reload();
  await p.getByTestId('material-nuevo').fill('Contrachapado 3 mm (prueba)');
  await p.getByTestId('crear-material').click();
  await foto(p, `proyecto-inicio_${ancho}.png`);
  await p.getByTestId('empezar-proyecto').click();
  await p.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'llavero.svg'));
  await p.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'placa.dxf'));
  // La placa queda seleccionada al importarla: se aparta 100 mm a la derecha con el teclado.
  await p.getByTestId('lienzo').focus();
  for (let i = 0; i < 10; i++) await p.keyboard.press('Shift+ArrowRight');
  await foto(p, `lienzo-importado_${ancho}.png`);

  // Selección con recuadro alrededor del llavero (0..60 x 0..30 mm) y zoom x2 sobre él.
  const aPantalla = (x, y) =>
    p.evaluate(([x, y]) => {
      const a = document.querySelector('[data-testid="lienzo-area"]');
      const q = new DOMPoint(x, y).matrixTransform(a.getScreenCTM());
      return { x: q.x, y: q.y };
    }, [x, y]);
  await p.getByTestId('lienzo').scrollIntoViewIfNeeded();
  let a = await aPantalla(-4, 36);
  let b = await aPantalla(64, -1);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b.x, b.y, { steps: 6 });
  await p.mouse.up();
  const c = await aPantalla(30, 15);
  for (let i = 0; i < 3; i++) await p.mouse.move(c.x, c.y), await p.mouse.wheel(0, -260);
  // Ajustes de PRUEBA en las capas (no son ajustes de ningún material real).
  const capa = async (n, modo, v) => {
    await p.getByTestId(`capa-${n}-modo`).selectOption(modo);
    for (const [k, x] of Object.entries(v)) await p.getByTestId(`capa-${n}-${k}`).fill(x);
  };
  await capa(1, 'corte', { potencia: '80', velocidad: '600', pasadas: '2' });
  await capa(2, 'corte', { potencia: '15', velocidad: '1500', pasadas: '1' });
  await capa(3, 'grabado', { potencia: '40', velocidad: '3000', pasadas: '1', intervalo: '0.25' });
  await foto(p, `lienzo-seleccion-zoom_${ancho}.png`);
  await foto(p, `capas_${ancho}.png`, '.lateral');
  await p.getByTestId('panel-material').locator('summary').click();
  await p.getByTestId('ajuste-corte-potencia').fill('80');
  await p.getByTestId('ajuste-corte-velocidad').fill('600');
  await p.getByTestId('ajuste-corte-pasadas').fill('2');
  await p.getByTestId('guardar-ajustes').click();
  await foto(p, `materiales_${ancho}.png`, '[data-testid="panel-material"]');
  await ctx.close();
}
app.s.close();
await navegador.close();
if (problemas.length) {
  console.error(problemas.join('\n'));
  process.exit(1);
}
console.log('Sin desbordamiento horizontal en 1280 ni en 390.');
