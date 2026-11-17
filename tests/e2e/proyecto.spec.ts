// Fase 1: exportar el proyecto (bloqueo por figuras fuera del área, descarga que pasa el
// validador de QA) y materiales (ajustes guardados, .json estricto).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { casosGolden, DIR_GOLDEN, limitesDe, lint, RAIZ, sha256 } from '../util';

const MUESTRAS = join(RAIZ, 'tests', 'muestras');
const CASOS = casosGolden();
const CLAVE_PERFILES = 'chopilaser.perfiles.v1';
const CLAVE_MATERIALES = 'chopilaser.materiales.v1';

async function preparar(page: Page, perfil: Record<string, string>, materiales: unknown[] = []) {
  await page.goto('./');
  await page.evaluate(
    ([kp, km, p, m]) => {
      localStorage.clear();
      localStorage.setItem(kp, JSON.stringify({ activo: 0, perfiles: [p] }));
      if ((m as unknown[]).length) localStorage.setItem(km, JSON.stringify({ materiales: m }));
    },
    [CLAVE_PERFILES, CLAVE_MATERIALES, perfil, materiales] as const,
  );
  await page.reload();
}

async function empezarCon(page: Page, nombreMaterial: string, crear = true) {
  if (crear) {
    await page.getByTestId('material-nuevo').fill(nombreMaterial);
    await page.getByTestId('crear-material').click();
  } else await page.getByTestId('material-select').selectOption({ label: nombreMaterial });
  await page.getByTestId('empezar-proyecto').click();
}

async function llenarCapa(page: Page, n: number, v: Record<string, string>) {
  if (v.modo) await page.getByTestId(`capa-${n}-modo`).selectOption(v.modo);
  for (const k of ['potencia', 'velocidad', 'pasadas', 'intervalo'] as const)
    if (v[k] !== undefined) await page.getByTestId(`capa-${n}-${k}`).fill(v[k]);
}

/** Exporta forzando Blob + <a download> (como en Firefox) y devuelve los bytes. */
async function exportarDescarga(page: Page): Promise<Buffer> {
  await page.evaluate(() => {
    delete (window as any).showSaveFilePicker;
    delete (Object.getPrototypeOf(window) as any).showSaveFilePicker;
  });
  const d = page.waitForEvent('download');
  await page.getByTestId('exportar-proyecto').click();
  const descarga = await d;
  expect(descarga.suggestedFilename()).toBe('proyecto.gcode');
  return readFileSync(await descarga.path());
}

test.describe('exportar el proyecto', () => {
  test('una figura fuera del área bloquea la exportación con un mensaje visible', async ({ page }) => {
    await preparar(page, CASOS[0].perfilPrueba);
    await empezarCon(page, 'Prueba');
    await page.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'cuadrados.svg'));
    await llenarCapa(page, 1, { potencia: '50', velocidad: '600', pasadas: '1' });
    await llenarCapa(page, 2, { potencia: '50', velocidad: '600', pasadas: '1' });
    await expect(page.getByTestId('exportar-estado')).toHaveText('');
    // Los dos cuadrados (caja de 60 mm) a X = 390: se salen del área de 400.
    await page.getByTestId('lienzo').focus();
    await page.keyboard.press('Escape');
    await page.getByTestId('lienzo').focus();
    await page.keyboard.press('Control+a');
    await page.getByTestId('prop-x').fill('390');
    await page.getByTestId('prop-x').press('Enter');
    const estado = page.getByTestId('exportar-estado');
    await expect(estado).toHaveText('Hay 2 figuras fuera del área de trabajo. Muévelas o achícalas para poder exportar.');
    await expect(estado).toBeVisible();
    await expect(page.locator('[data-testid="figura"].fuera')).toHaveCount(2);
    let descargas = 0;
    page.on('download', () => descargas++);
    await page.getByTestId('exportar-proyecto').click();
    await expect(estado).toHaveText(/fuera del área/);
    await page.waitForTimeout(300);
    expect(descargas).toBe(0);
    // Ocultar la salida de una capa: esa figura ya no cuenta.
    await page.getByTestId('capa-2-salida').uncheck();
    await expect(estado).toHaveText('Hay 1 figura fuera del área de trabajo. Muévela o achícala para poder exportar.');
    // De vuelta dentro: se puede exportar.
    await page.getByTestId('prop-x').fill('340'); // caja 340..400: justo en el borde
    await page.getByTestId('prop-x').press('Enter');
    await expect(page.locator('[data-testid="figura"].fuera')).toHaveCount(0);
    await expect(estado).toHaveText('');
  });

  test('una capa incompleta bloquea con su número', async ({ page }) => {
    await preparar(page, CASOS[0].perfilPrueba);
    await empezarCon(page, 'Prueba');
    await page.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'cuadrados.svg'));
    await llenarCapa(page, 1, { potencia: '50', velocidad: '600', pasadas: '1' });
    await page.getByTestId('exportar-proyecto').click();
    await expect(page.getByTestId('exportar-estado')).toHaveText('Completa los ajustes de la capa 2 para poder exportar.');
    await expect(page.getByTestId('capa-2-error')).not.toHaveText('');
  });

  for (const caso of CASOS) {
    test(`perfil ${caso.perfil}: la placa exportada coincide con el golden y pasa el validador`, async ({ page }, info) => {
      await preparar(page, caso.perfilPrueba);
      await empezarCon(page, 'Prueba');
      await page.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'placa.dxf'));
      // Igual que tests/golden/proyectos.json: mover (30, 40) mm, capa 2 sin salida.
      await page.getByTestId('lienzo').focus();
      await page.keyboard.press('Control+a');
      for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
      for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowUp');
      await llenarCapa(page, 1, { potencia: '100', velocidad: '400', pasadas: '1' });
      await llenarCapa(page, 2, { potencia: '10', velocidad: '2000', pasadas: '1' });
      await page.getByTestId('capa-2-salida').uncheck();
      const bytes = await exportarDescarga(page);
      await expect(page.getByTestId('exportar-estado')).toHaveText('Archivo descargado.');
      const golden = readFileSync(join(DIR_GOLDEN, caso.archivo.replace(/^cuadricula_/, 'proyecto-placa_')));
      expect(sha256(bytes)).toBe(sha256(golden));
      const ruta = info.outputPath(`placa_${caso.perfil}.gcode`);
      writeFileSync(ruta, bytes);
      const r = lint(ruta, limitesDe(caso));
      expect(r.salida).toContain('0 errores, 0 avisos');
      expect(r.codigo).toBe(0);
    });
  }

  test('el llavero con grabado y corte exportado pasa el validador', async ({ page }, info) => {
    const caso = CASOS[1]; // área negativa
    await preparar(page, caso.perfilPrueba);
    await empezarCon(page, 'Prueba');
    await page.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'llavero.svg'));
    await llenarCapa(page, 1, { potencia: '80', velocidad: '600', pasadas: '2' });
    await llenarCapa(page, 2, { potencia: '15', velocidad: '1500', pasadas: '1' });
    await llenarCapa(page, 3, { modo: 'grabado', potencia: '40', velocidad: '3000', pasadas: '1', intervalo: '0.25' });
    const bytes = await exportarDescarga(page);
    const texto = bytes.toString('ascii');
    expect(texto.indexOf('M4')).toBeLessThan(texto.indexOf('M3'));
    const ruta = info.outputPath('llavero.gcode');
    writeFileSync(ruta, bytes);
    const r = lint(ruta, limitesDe(caso));
    expect(r.salida).toContain('0 errores, 0 avisos');
    expect(r.codigo).toBe(0);
  });
});

test.describe('materiales', () => {
  test('ajustes guardados: las capas nuevas toman el corte y al cambiar a grabado, el grabado', async ({ page }) => {
    await preparar(page, CASOS[0].perfilPrueba);
    await empezarCon(page, 'Pino 3 mm');
    // Sin ajustes, las capas empiezan vacías (no se inventan valores).
    await page.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'cuadrados.svg'));
    await expect(page.getByTestId('capa-1-potencia')).toHaveValue('');
    await page.getByTestId('panel-material').locator('summary').click();
    await page.getByTestId('ajuste-corte-potencia').fill('101');
    await page.getByTestId('ajuste-corte-velocidad').fill('300');
    await page.getByTestId('ajuste-corte-pasadas').fill('2');
    await page.getByTestId('guardar-ajustes').click();
    await expect(page.getByTestId('ajustes-estado')).toHaveText('Potencia: escribe un número de 1 a 100.');
    await page.getByTestId('ajuste-corte-potencia').fill('0');
    await page.getByTestId('guardar-ajustes').click();
    await expect(page.getByTestId('ajustes-estado')).toHaveText('Potencia: escribe un número de 1 a 100.');
    await page.getByTestId('ajuste-corte-potencia').fill('90');
    for (const [k, v] of Object.entries({ potencia: '30', velocidad: '3000', pasadas: '1', intervalo: '0.1' }))
      await page.getByTestId(`ajuste-grabado-${k}`).fill(v);
    await page.getByTestId('guardar-ajustes').click();
    await expect(page.getByTestId('ajustes-estado')).toHaveText('Ajustes guardados.');
    const guardado = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), CLAVE_MATERIALES);
    expect(guardado.materiales[0]).toEqual({
      nombre: 'Pino 3 mm',
      corte: { potencia: '90', velocidad: '300', pasadas: '2' },
      grabado: { potencia: '30', velocidad: '3000', pasadas: '1', intervalo: '0.1' },
    });
    // Proyecto nuevo con ese material: las capas nuevas ya traen el corte.
    page.on('dialog', (d) => d.accept());
    await page.getByTestId('nuevo-proyecto').click();
    await empezarCon(page, 'Pino 3 mm', false);
    await page.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'cuadrados.svg'));
    await expect(page.getByTestId('capa-1-potencia')).toHaveValue('90');
    await expect(page.getByTestId('capa-1-velocidad')).toHaveValue('300');
    await expect(page.getByTestId('capa-1-pasadas')).toHaveValue('2');
    await page.getByTestId('capa-2-modo').selectOption('grabado');
    await expect(page.getByTestId('capa-2-potencia')).toHaveValue('30');
    await expect(page.getByTestId('capa-2-intervalo')).toHaveValue('0.1');
  });

  test('exportar e importar materiales en .json (estricto)', async ({ page }, info) => {
    const pino = { nombre: 'Pino', corte: { potencia: '90', velocidad: '300', pasadas: '2' }, grabado: { potencia: '', velocidad: '', pasadas: '', intervalo: '' } };
    await preparar(page, CASOS[0].perfilPrueba, [pino]);
    await empezarCon(page, 'Pino', false);
    await page.getByTestId('panel-material').locator('summary').click();
    const d = page.waitForEvent('download');
    await page.getByTestId('exportar-materiales').click();
    const descarga = await d;
    expect(descarga.suggestedFilename()).toBe('chopilaser-materiales.json');
    const json = JSON.parse(readFileSync(await descarga.path(), 'utf8'));
    expect(json).toEqual({ formato: 'chopilaser-materiales', version: 1, materiales: [pino] });

    // Importar el mismo archivo: nombre repetido, no se importa nada.
    const estado = page.getByTestId('materiales-estado');
    await page.getByTestId('importar-materiales-archivo').setInputFiles(await descarga.path());
    await expect(estado).toHaveText('No se importó nada: el material 1 no es válido (Nombre: Ya hay un material con ese nombre.)');
    // Un dato desconocido: tampoco.
    const malo = info.outputPath('malo.json');
    writeFileSync(malo, JSON.stringify({ ...json, materiales: [{ ...pino, nombre: 'MDF', color: 'rojo' }] }));
    await page.getByTestId('importar-materiales-archivo').setInputFiles(malo);
    await expect(estado).toHaveText('No se importó nada: el material 1 tiene un dato desconocido («color»).');
    const bueno = info.outputPath('bueno.json');
    writeFileSync(bueno, JSON.stringify({ ...json, materiales: [{ ...pino, nombre: 'MDF' }, { ...pino, nombre: 'Acrílico' }] }));
    await page.getByTestId('importar-materiales-archivo').setInputFiles(bueno);
    await expect(estado).toHaveText('Se importaron 2 materiales.');
    const guardado = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), CLAVE_MATERIALES);
    expect(guardado.materiales.map((m: { nombre: string }) => m.nombre)).toEqual(['Pino', 'MDF', 'Acrílico']);
    // Aparecen al empezar otro proyecto.
    page.on('dialog', (dl) => dl.accept());
    await page.getByTestId('nuevo-proyecto').click();
    await expect(page.getByTestId('material-select').locator('option')).toContainText(['Pino', 'MDF', 'Acrílico']);
  });
});

test.describe('ajustes del material: campos anchos (N1)', () => {
  for (const ancho of [1280, 390]) {
    test(`a ${ancho} px los campos miden al menos 70 px y muestran el valor entero`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 900 });
      await preparar(page, CASOS[0].perfilPrueba);
      await empezarCon(page, 'Pino 3 mm');
      await page.getByTestId('panel-material').locator('summary').click();
      const valores: Record<string, string> = { potencia: '100', velocidad: '60000', pasadas: '100', intervalo: '0.125' };
      for (const modo of ['corte', 'grabado'])
        for (const [k, v] of Object.entries(valores)) {
          const input = page.getByTestId(`ajuste-${modo}-${k}`);
          if (!(await input.count())) continue;
          await input.fill(v);
          const caja = (await input.boundingBox())!;
          expect(caja.width, `${modo}-${k}`).toBeGreaterThanOrEqual(70);
          // El texto cabe: el contenido no desborda la caja.
          const m = await input.evaluate((el: HTMLInputElement) => ({ scroll: el.scrollWidth, cliente: el.clientWidth }));
          expect(m.scroll, `${modo}-${k}`).toBeLessThanOrEqual(m.cliente);
        }
    });
  }
});
