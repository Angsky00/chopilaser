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
    await expect(estado(page)).toHaveText('Con estos ajustes no queda ninguna forma. Prueba con otro umbral o desactiva «Invertir».');
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

  test('una imagen de más de 4000 px por lado se rechaza con un mensaje visible', async ({ page }, info) => {
    const png = new PNG({ width: 4001, height: 4 });
    png.data.fill(255);
    const ruta = info.outputPath('grande.png');
    writeFileSync(ruta, PNG.sync.write(png));
    await page.getByTestId('importar-diseno').setInputFiles(ruta);
    await expect(page.getByTestId('proyecto-estado')).toHaveText(
      'No se pudo importar «grande.png»: La imagen mide 4001 × 4 px. El máximo es 4000 px por lado: achícala y vuelve a intentarlo.',
    );
    await expect(page.getByTestId('panel-trazado')).toBeHidden();
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
