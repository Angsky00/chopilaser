// Capturas de la fase 0 (y de la maqueta de Marketing para comparar) en 1280 y 390 px.
// Uso: npm run build && node tools/capturas.mjs [ruta-de-la-maqueta]
// Comprueba además que no haya desbordamiento horizontal.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const SALIDA = join(RAIZ, 'capturas', 'fase-0');
const MAQUETA = process.argv[2];
mkdirSync(SALIDA, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.gcode': 'text/plain', '.txt': 'text/plain',
};
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

// Perfil de PRUEBA (no son los valores de la máquina de Angel).
const PERFIL = { nombre: 'Láser de prueba', sMax: '1000', laserMode32: '1', origen: 'inferior-izquierda', camaAncho: '400', camaAlto: '400' };

const navegador = await chromium.launch();
const problemas = [];
async function pagina(ancho) {
  const alto = ancho > 600 ? 800 : 844;
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
  return ctx.newPage();
}
async function foto(page, nombre, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (desborde > 0) problemas.push(`${nombre}: desborda ${desborde}px en horizontal`);
  await page.screenshot({ path: join(SALIDA, nombre), fullPage });
  console.log('captura', join('capturas/fase-0', nombre));
}

const app = await servir(join(RAIZ, 'dist'));
for (const ancho of [1280, 390]) {
  let p = await pagina(ancho);
  await p.goto(app.url);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await foto(p, `configuracion-primera-vez_${ancho}.png`);
  await p.getByTestId('preset-grbl').click();
  await p.getByText('Pegar salida de $$').click();
  await p.getByTestId('pegar-dolar').fill('$30=1000\n$32=1\n$130=400.000\n$131=400.000\nok');
  await p.getByTestId('leer-dolar').click();
  await p.getByTestId('perfil-nombre').fill(PERFIL.nombre);
  await p.getByTestId('origen').selectOption(PERFIL.origen);
  await foto(p, `configuracion-llena_${ancho}.png`);
  await p.getByTestId('origen').selectOption('personalizada');
  await foto(p, `configuracion-avanzado_${ancho}.png`);
  await p.getByTestId('origen').selectOption(PERFIL.origen);
  await p.getByTestId('guardar-perfil').click();
  await p.getByTestId('generar').click();
  await foto(p, `cuadricula_${ancho}.png`);
  // Exportar: en el navegador headless se usa la ruta de descarga.
  await p.evaluate(() => { delete window.showSaveFilePicker; });
  const d = p.waitForEvent('download');
  await p.getByTestId('exportar').click();
  await d;
  await foto(p, `exportar_${ancho}.png`);
  await p.getByTestId('maquina').click();
  await foto(p, `maquina-editar_${ancho}.png`);
  await p.context().close();
}
app.s.close();

if (MAQUETA) {
  const m = await servir(resolve(MAQUETA));
  for (const ancho of [1280, 390]) {
    for (const vista of ['configuracion', 'exportar']) {
      const p = await pagina(ancho);
      await p.goto(`${m.url}index.html?vista=${vista}&captura=1`);
      await p.waitForFunction(() => window.__chopiReady === true, null, { timeout: 8000 }).catch(() => {});
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(250);
      await p.screenshot({ path: join(SALIDA, `maqueta-${vista}_${ancho}.png`) });
      console.log('captura', `capturas/fase-0/maqueta-${vista}_${ancho}.png`);
      await p.context().close();
    }
  }
  m.s.close();
}
await navegador.close();
if (problemas.length) {
  console.error(problemas.join('\n'));
  process.exit(1);
}
console.log('Sin desbordamiento horizontal en 1280 ni en 390.');
