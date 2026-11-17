// Capturas de la fase 1b (vectorizar imagen) en 1280 y 390 px.
// Uso: npm run build && node tools/capturas-fase1b.mjs
// Comprueba además que no haya desbordamiento horizontal.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const SALIDA = join(RAIZ, 'capturas', 'fase-1b');
const REF = join(RAIZ, 'tests', 'vector_ref');
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
  console.log('captura', join('capturas/fase-1b', nombre));
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
  await p.getByTestId('empezar-proyecto').click();
  // Imagen de referencia de QA con ruido: se ve el efecto de «Quitar manchas».
  await p.getByTestId('importar-diseno').setInputFiles(join(REF, 'logo_ruido.png'));
  await p.getByTestId('trazado-estado').filter({ hasText: '3 formas y 2 huecos.' }).waitFor();
  await foto(p, `trazado-panel_${ancho}.png`, '[data-testid="panel-trazado"]');
  await p.getByTestId('trazado-aceptar').click();
  await p.getByTestId('figura').first().waitFor();
  await foto(p, `trazado-resultado_${ancho}.png`);
  await ctx.close();
}
app.s.close();
await navegador.close();
if (problemas.length) {
  console.error(problemas.join('\n'));
  process.exit(1);
}
console.log('Sin desbordamiento horizontal en 1280 ni en 390.');
