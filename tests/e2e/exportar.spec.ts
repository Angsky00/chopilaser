// Exporta la cuadrícula de prueba en cada navegador y comprueba que el archivo
// es idéntico al golden (SHA-256) y que pasa el validador de QA sin --laser-mode.
// Las configuraciones son de PRUEBA, no los valores reales de la máquina de Angel.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { casosGolden, DIR_GOLDEN, lint, sha256, type MaquinaPrueba } from '../util';

const tmp = mkdtempSync(join(tmpdir(), 'chopilaser-e2e-'));

async function configurar(page: Page, m: { sMax: string; camaAncho: string; camaAlto: string; modo32?: string }) {
  await page.getByTestId('s-max').fill(m.sMax);
  await page.getByTestId('cama-ancho').fill(m.camaAncho);
  await page.getByTestId('cama-alto').fill(m.camaAlto);
  await page.getByTestId('modo-32').selectOption(m.modo32 ?? '');
}

function comprobarArchivo(bytes: Buffer, archivoGolden: string, m: MaquinaPrueba, nombre: string) {
  const golden = readFileSync(join(DIR_GOLDEN, archivoGolden));
  expect(bytes[0]).not.toBe(0xef); // sin BOM
  expect(bytes.includes(0x0d)).toBe(false); // solo LF
  expect(sha256(bytes)).toBe(sha256(golden));
  const f = join(tmp, nombre);
  writeFileSync(f, bytes);
  const r = lint(f, m);
  expect(r.salida).toContain('0 errores, 0 avisos');
  expect(r.codigo).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('sin configuración no hay valores por defecto y todo está bloqueado', async ({ page }) => {
  await expect(page.getByTestId('s-max')).toHaveValue('');
  await expect(page.getByTestId('cama-ancho')).toHaveValue('');
  await expect(page.getByTestId('cama-alto')).toHaveValue('');
  await expect(page.getByTestId('generar')).toBeDisabled();
  await expect(page.getByTestId('exportar')).toBeDisabled();
  await expect(page.getByTestId('errores')).toContainText('S máximo ($30)');
});

const INVALIDOS = ['', '0', '-5', 'abc', 'NaN'];
for (const campo of ['s-max', 'cama-ancho', 'cama-alto'] as const) {
  test(`exportación bloqueada con ${campo} no válido`, async ({ page }) => {
    await configurar(page, { sMax: '1000', camaAncho: '400', camaAlto: '400' });
    await page.getByTestId('generar').click();
    await expect(page.getByTestId('exportar')).toBeEnabled();
    for (const valor of INVALIDOS) {
      await page.getByTestId(campo).fill(valor);
      await expect(page.getByTestId('exportar')).toBeDisabled();
      await expect(page.getByTestId('generar')).toBeDisabled();
      await expect(page.getByTestId('errores')).not.toBeEmpty();
      await expect(page.getByTestId('salida')).toHaveValue('');
    }
  });
}

test('la configuración se guarda en localStorage, $32 incluido', async ({ page }) => {
  await configurar(page, { sMax: '255', camaAncho: '300', camaAlto: '200', modo32: '1' });
  await page.reload();
  await expect(page.getByTestId('s-max')).toHaveValue('255');
  await expect(page.getByTestId('cama-ancho')).toHaveValue('300');
  await expect(page.getByTestId('cama-alto')).toHaveValue('200');
  await expect(page.getByTestId('modo-32')).toHaveValue('1');
  await expect(page.getByTestId('generar')).toBeEnabled();
});

for (const caso of casosGolden()) {
  const m = caso.maquinaPrueba;
  const cfg = { sMax: String(m.sMax), camaAncho: String(m.camaAncho), camaAlto: String(m.camaAlto) };

  test(`exporta ${caso.archivo} por la ruta del navegador`, async ({ page, browserName }, info) => {
    const tieneSelector = await page.evaluate(() => typeof (window as any).showSaveFilePicker === 'function');
    if (tieneSelector) {
      // Chromium/Edge: el diálogo nativo no se puede automatizar; se sustituye por un
      // manejador falso que captura los bytes que la app escribe con createWritable().
      await page.evaluate(() => {
        (window as any).__guardado = null;
        (window as any).showSaveFilePicker = async (op: { suggestedName: string }) => ({
          async createWritable() {
            const partes: Blob[] = [];
            return {
              async write(d: Blob) {
                partes.push(d);
              },
              async close() {
                const buf = await new Blob(partes).arrayBuffer();
                (window as any).__guardado = { nombre: op.suggestedName, bytes: Array.from(new Uint8Array(buf)) };
              },
            };
          },
        });
      });
    } else {
      expect(browserName).toBe('firefox');
    }
    await configurar(page, cfg);
    await page.getByTestId('generar').click();
    await expect(page.getByTestId('exportar')).toBeEnabled();

    let bytes: Buffer;
    if (tieneSelector) {
      await page.getByTestId('exportar').click();
      await expect(page.getByTestId('estado')).toHaveAttribute('data-ruta', 'selector');
      const g = await page.evaluate(() => (window as any).__guardado);
      expect(g.nombre).toBe('cuadricula_prueba.gcode');
      bytes = Buffer.from(g.bytes);
    } else {
      const descarga = page.waitForEvent('download');
      await page.getByTestId('exportar').click();
      const d = await descarga;
      expect(d.suggestedFilename()).toBe('cuadricula_prueba.gcode');
      bytes = readFileSync(await d.path());
      await expect(page.getByTestId('estado')).toHaveAttribute('data-ruta', 'descarga');
    }
    comprobarArchivo(bytes, caso.archivo, m, `${info.project.name}_${caso.archivo}`);
  });

  test(`exporta ${caso.archivo} por la ruta de respaldo (descarga)`, async ({ page }, info) => {
    // Quita la API para forzar Blob + <a download>, como en Firefox.
    await page.evaluate(() => {
      delete (window as any).showSaveFilePicker;
      delete (Object.getPrototypeOf(window) as any).showSaveFilePicker;
    });
    expect(await page.evaluate(() => 'showSaveFilePicker' in window)).toBe(false);
    await configurar(page, cfg);
    await page.getByTestId('generar').click();
    const descarga = page.waitForEvent('download');
    await page.getByTestId('exportar').click();
    const d = await descarga;
    expect(d.suggestedFilename()).toBe('cuadricula_prueba.gcode');
    comprobarArchivo(readFileSync(await d.path()), caso.archivo, m, `${info.project.name}_respaldo_${caso.archivo}`);
  });
}
