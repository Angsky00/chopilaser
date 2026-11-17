// Fase 1b: vectorizar PNG/JPG en el navegador (potrace wasm en un Web Worker).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { casosGolden, limitesDe, lint, RAIZ } from '../util';

const REF = join(RAIZ, 'tests', 'vector_ref');
const CASO = casosGolden()[0]; // perfil de PRUEBA a: área 0..400 mm

async function empezar(page: Page) {
  await page.goto('./');
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem('chopilaser.perfiles.v1', JSON.stringify({ activo: 0, perfiles: [p] }));
  }, CASO.perfilPrueba);
  await page.reload();
  await page.getByTestId('material-nuevo').fill('Prueba');
  await page.getByTestId('crear-material').click();
  await page.getByTestId('empezar-proyecto').click();
}

const estado = (page: Page) => page.getByTestId('trazado-estado');

test.describe('vectorizar imagen', () => {
  test.beforeEach(async ({ page }) => empezar(page));

  test('importa un PNG, lo traza con vista previa y lo pone en el lienzo como figuras editables', async ({ page }) => {
    await page.getByTestId('importar-diseno').setInputFiles(join(REF, 'logo_bn.png'));
    const panel = page.getByTestId('panel-trazado');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('trazado-medida')).toContainText('400 × 400 px a 96 ppp (la imagen no indica su resolución): 105,8 × 105,8 mm.');
    await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
    await expect(page.getByTestId('trazado-svg').locator('path')).toHaveCount(1);
    // Vista previa en vivo: con umbral 0 no queda nada y no se puede aceptar.
    await page.getByTestId('trazado-umbral').fill('0');
    await expect(estado(page)).toHaveText('Con estos ajustes no queda ninguna forma. Prueba con otro umbral o cambia «Invertir».');
    await expect(page.getByTestId('trazado-aceptar')).toBeDisabled();
    await page.getByTestId('trazado-umbral').fill('128');
    await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
    await expect(page.getByTestId('trazado-aceptar')).toBeEnabled();
    await page.getByTestId('trazado-aceptar').click();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('proyecto-estado')).toHaveText('Se importaron 3 figuras de «logo_bn.png».');
    await expect(page.getByTestId('figura')).toHaveCount(3);
    await expect(page.locator('[data-testid^="capa-"][data-color]')).toHaveCount(1); // una sola capa
    // Quedan seleccionadas: caja de 40..360 px a 96 ppp.
    expect(Number(await page.getByTestId('prop-ancho').inputValue())).toBeCloseTo((320 * 25.4) / 96, 0);
    // Son editables: se mueven con el teclado.
    await page.getByTestId('lienzo').focus();
    await page.keyboard.press('Shift+ArrowRight');
    expect(Number(await page.getByTestId('prop-x').inputValue())).toBeCloseTo((40 * 25.4) / 96 + 10, 0);
  });

  test('quitar manchas limpia el ruido sin comerse los huecos', async ({ page }) => {
    await page.getByTestId('importar-diseno').setInputFiles(join(REF, 'logo_ruido.png'));
    await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
    await page.getByTestId('trazado-manchas').fill('0');
    await expect(estado(page)).not.toHaveText(/^(3 formas y 2 huecos\.|Trazando…)$/);
    await page.getByTestId('trazado-manchas').fill('10');
    await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
  });

  test('PNG con transparencia y JPG dan el mismo resultado que el original', async ({ page }) => {
    for (const n of ['logo_transparente.png', 'logo_jpg_q30.jpg']) {
      await page.getByTestId('importar-diseno').setInputFiles(join(REF, n));
      await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
      await page.getByTestId('trazado-cancelar').click();
      await expect(page.getByTestId('panel-trazado')).toBeHidden();
    }
    await expect(page.getByTestId('figura')).toHaveCount(0);
  });

  test('invertir y desenfoque cambian la vista previa', async ({ page }) => {
    await page.getByTestId('importar-diseno').setInputFiles(join(REF, 'logo_bn.png'));
    await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
    await page.getByTestId('trazado-invertir').check();
    await expect(estado(page)).toHaveText(/^\d+ formas? y \d+ huecos?\.$/);
    await expect(estado(page)).not.toHaveText('3 formas y 2 huecos.');
    await page.getByTestId('trazado-invertir').uncheck();
    await page.getByTestId('trazado-desenfoque').fill('3');
    await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
  });

  test('una imagen de 4001 px de ancho se reduce a 4000 px (no se rechaza) con el aviso de Marketing', async ({ page }, info) => {
    const png = new PNG({ width: 4001, height: 4 });
    png.data.fill(255);
    const ruta = info.outputPath('grande.png');
    writeFileSync(ruta, PNG.sync.write(png));
    await page.getByTestId('importar-diseno').setInputFiles(ruta);
    await expect(page.getByTestId('panel-trazado')).toBeVisible();
    await expect(page.getByTestId('trazado-aviso')).toHaveText('La imagen medía 4001 × 4 px y se redujo a 4000 × 4 px, el máximo es 4000 px por lado.');
    await expect(page.getByTestId('trazado-medida')).toContainText('4000 × 4 px');
  });

  test('una imagen de 6000 px se reduce a 4000 px con la misma proporción, sin congelar la pestaña', async ({ page }, info) => {
    test.setTimeout(90_000);
    // 6000 × 3000 px, blanca con un rectángulo negro en el centro (1500..4500 × 750..2250).
    const png = new PNG({ width: 6000, height: 3000 });
    png.data.fill(255);
    for (let y = 750; y < 2250; y++) png.data.fill(0, (y * 6000 + 1500) * 4, (y * 6000 + 4500) * 4);
    for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
    const ruta = info.outputPath('enorme.png');
    writeFileSync(ruta, PNG.sync.write(png, { deflateLevel: 1 }));
    // Latido en el hilo de la interfaz: guarda el mayor hueco entre ticks.
    await page.evaluate(() => {
      const w = window as any;
      w.__maxHueco = 0;
      let ultimo = performance.now();
      w.__latido = setInterval(() => {
        const t = performance.now();
        w.__maxHueco = Math.max(w.__maxHueco, t - ultimo);
        ultimo = t;
      }, 20);
    });
    await page.getByTestId('importar-diseno').setInputFiles(ruta);
    await expect(page.getByTestId('trazado-aviso')).toHaveText(
      'La imagen medía 6000 × 3000 px y se redujo a 4000 × 2000 px, el máximo es 4000 px por lado.',
      { timeout: 30_000 },
    );
    // Se conserva el tamaño en mm (96 ppp → 64 ppp).
    await expect(page.getByTestId('trazado-medida')).toContainText('4000 × 2000 px a 64 ppp (la imagen no indica su resolución): 1587,5 × 793,8 mm.');
    await expect(estado(page)).toHaveText('1 forma y 0 huecos.', { timeout: 30_000 });
    const svg = page.getByTestId('trazado-svg');
    await expect(svg).toHaveAttribute('viewBox', '0 0 4000 2000');
    const hueco = await page.evaluate(() => {
      const w = window as any;
      clearInterval(w.__latido);
      return w.__maxHueco as number;
    });
    info.annotations.push({ type: 'mayor hueco del hilo de la interfaz (ms)', description: hueco.toFixed(0) });
    expect(hueco).toBeLessThan(1000);
  });

  test('los archivos .jpeg también se aceptan', async ({ page }, info) => {
    const ruta = info.outputPath('logo.jpeg');
    writeFileSync(ruta, readFileSync(join(REF, 'logo_jpg_q30.jpg')));
    await page.getByTestId('importar-diseno').setInputFiles(ruta);
    await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
  });

  test('el G-code de una imagen vectorizada pasa el validador', async ({ page }, info) => {
    await page.getByTestId('importar-diseno').setInputFiles(join(REF, 'logo_bn.png'));
    await expect(estado(page)).toHaveText('3 formas y 2 huecos.');
    await page.getByTestId('trazado-aceptar').click();
    for (const [k, v] of Object.entries({ potencia: '85', velocidad: '500', pasadas: '1' })) await page.getByTestId(`capa-1-${k}`).fill(v);
    await page.evaluate(() => {
      delete (window as any).showSaveFilePicker;
      delete (Object.getPrototypeOf(window) as any).showSaveFilePicker;
    });
    const d = page.waitForEvent('download');
    await page.getByTestId('exportar-proyecto').click();
    const bytes = readFileSync(await (await d).path());
    // Mismo resultado que el golden de Vitest (mismo wasm, mismos ajustes).
    expect(bytes.equals(readFileSync(join(RAIZ, 'tests', 'golden', 'trazado-logo-bn_a_s1000.gcode')))).toBe(true);
    const ruta = info.outputPath('trazado.gcode');
    writeFileSync(ruta, bytes);
    const r = lint(ruta, limitesDe(CASO));
    expect(r.salida).toContain('0 errores, 0 avisos');
    expect(r.codigo).toBe(0);
  });
});
