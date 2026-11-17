// Pruebas de la interfaz: pantalla de configuración inicial, perfiles y exportación.
// La cuadrícula exportada en cada navegador debe ser idéntica al golden (SHA-256)
// y pasar el validador de QA sin --laser-mode.
// Los perfiles son de PRUEBA, no los valores reales de la máquina de Angel.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { casosGolden, DIR_GOLDEN, limitesDe, lint, sha256, type CasoGolden } from '../util';

const tmp = mkdtempSync(join(tmpdir(), 'chopilaser-e2e-'));
const CASOS = casosGolden();
const CLAVE = 'chopilaser.perfiles.v1';

async function llenarPerfil(page: Page, p: Record<string, string>) {
  await page.getByTestId('perfil-nombre').fill(p.nombre ?? '');
  await page.getByTestId('s-max').fill(p.sMax ?? '');
  await page.getByTestId('modo-32').selectOption(p.laserMode32 ?? '');
  await page.getByTestId('origen').selectOption(p.origen ?? '');
  if (p.origen === 'personalizada') {
    for (const [campo, id] of [
      ['xMin', 'x-min'],
      ['yMin', 'y-min'],
      ['xMax', 'x-max'],
      ['yMax', 'y-max'],
    ]) {
      await page.getByTestId(id).fill(p[campo] ?? '');
    }
  } else {
    await page.getByTestId('cama-ancho').fill(p.camaAncho ?? '');
    await page.getByTestId('cama-alto').fill(p.camaAlto ?? '');
  }
}

async function crearPerfil(page: Page, p: Record<string, string>) {
  await expect(page.getByTestId('pantalla-maquina')).toBeVisible();
  await llenarPerfil(page, p);
  await expect(page.getByTestId('guardar-perfil')).toBeEnabled();
  await page.getByTestId('guardar-perfil').click();
  await expect(page.getByTestId('app-principal')).toBeVisible();
}

function comprobarArchivo(bytes: Buffer, caso: CasoGolden, nombre: string) {
  const golden = readFileSync(join(DIR_GOLDEN, caso.archivo));
  expect(bytes[0]).not.toBe(0xef); // sin BOM
  expect(bytes.includes(0x0d)).toBe(false); // solo LF
  expect(sha256(bytes)).toBe(sha256(golden));
  const f = join(tmp, nombre);
  writeFileSync(f, bytes);
  const r = lint(f, limitesDe(caso));
  expect(r.salida).toContain('0 errores, 0 avisos');
  expect(r.codigo).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.describe('primera vez', () => {
  test('muestra la pantalla de configuración antes que nada, sin valores por defecto', async ({ page }) => {
    await expect(page.getByTestId('pantalla-maquina')).toBeVisible();
    await expect(page.getByTestId('app-principal')).toBeHidden();
    await expect(page.getByTestId('generar')).toBeHidden();
    await expect(page.getByTestId('exportar')).toBeHidden();
    for (const id of ['perfil-nombre', 's-max', 'cama-ancho', 'cama-alto']) await expect(page.getByTestId(id)).toHaveValue('');
    await expect(page.getByTestId('origen')).toHaveValue('');
    await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
    await expect(page.getByTestId('cancelar-perfil')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Configura tu máquina' })).toBeVisible();
    await expect(page.getByTestId('pantalla-maquina')).toContainText(
      'ChopiLaser necesita saber cómo es tu láser antes de exportar. Solo se pide una vez; después lo cambias en «Máquina».',
    );
    await expect(page.getByLabel('Nombre de la máquina')).toHaveAttribute('placeholder', 'Ej. Láser del taller');
    await expect(page.getByLabel('Potencia máxima ($30)')).toBeVisible();
    await expect(page.getByLabel('Modo láser ($32)')).toBeVisible();
    await expect(page.getByLabel('Ancho (X)')).toBeVisible();
    await expect(page.getByLabel('Fondo (Y)')).toBeVisible();
    await expect(page.getByLabel('¿Dónde queda el 0,0 después del homing?')).toBeVisible();
    await expect(page.getByTestId('guardar-perfil')).toHaveText('Guardar y empezar');
    await expect(page.getByTestId('errores')).toHaveText('Completa los campos marcados para continuar.');
    await expect(page.getByTestId('error-nombre')).toHaveText('Este dato hace falta.');
    await expect(page.getByTestId('error-sMax')).toHaveText('Este dato hace falta.');
    await expect(page.getByTestId('error-camaAncho')).toHaveText('Este dato hace falta.');
    await expect(page.getByTestId('error-origen')).toHaveText('Este dato hace falta.');
  });

  const valido = { nombre: 'Prueba', sMax: '1000', laserMode32: '', origen: 'inferior-izquierda', camaAncho: '400', camaAlto: '400' };
  for (const [campo, id] of [
    ['sMax', 's-max'],
    ['camaAncho', 'cama-ancho'],
    ['camaAlto', 'cama-alto'],
  ] as const) {
    test(`valores no válidos en ${campo} bloquean el guardado`, async ({ page }) => {
      await llenarPerfil(page, valido);
      await expect(page.getByTestId('guardar-perfil')).toBeEnabled();
      for (const v of ['', '0', '-5', 'abc', 'NaN']) {
        await page.getByTestId(id).fill(v);
        await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
        await expect(page.getByTestId('errores')).toHaveText('Completa los campos marcados para continuar.');
        await expect(page.getByTestId(`error-${campo}`)).toHaveText(
          v === '' ? 'Este dato hace falta.' : 'Escribe un número mayor que 0.',
        );
        await expect(page.getByTestId(id)).toHaveAttribute('aria-invalid', 'true');
      }
      await page.getByTestId(id).fill('100');
      await expect(page.getByTestId('guardar-perfil')).toBeEnabled();
      await expect(page.getByTestId('errores')).toHaveText('');
      expect(await page.evaluate((k) => localStorage.getItem(k), CLAVE)).toBe(null);
    });
  }

  test('sin nombre o sin origen no se puede guardar', async ({ page }) => {
    await llenarPerfil(page, { ...valido, nombre: '   ' });
    await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
    await page.getByTestId('perfil-nombre').fill('Prueba');
    await expect(page.getByTestId('guardar-perfil')).toBeEnabled();
    await page.getByTestId('origen').selectOption('');
    await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
  });

  test('área personalizada no válida bloquea el guardado', async ({ page }) => {
    await llenarPerfil(page, { nombre: 'P', sMax: '1', origen: 'personalizada', xMin: '0', yMin: '0', xMax: '10', yMax: '10' });
    await expect(page.getByTestId('guardar-perfil')).toBeEnabled();
    await page.getByTestId('x-max').fill('-1');
    await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
    await page.getByTestId('x-max').fill('abc');
    await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
  });

  test('el botón de GRBL 1.1 llena solo $30=1000 y $32=0', async ({ page }) => {
    await expect(page.getByTestId('preset-grbl')).toHaveText('Usar valores de fábrica de GRBL 1.1');
    await expect(page.getByTestId('pantalla-maquina')).toContainText(
      'Llena $30=1000 y $32=0. El nombre, el área y el origen los pones tú.',
    );
    await page.getByTestId('preset-grbl').click();
    await expect(page.getByTestId('s-max')).toHaveValue('1000');
    await expect(page.getByTestId('modo-32')).toHaveValue('0');
    // El área, el origen y el nombre no se suponen.
    await expect(page.getByTestId('cama-ancho')).toHaveValue('');
    await expect(page.getByTestId('cama-alto')).toHaveValue('');
    await expect(page.getByTestId('origen')).toHaveValue('');
    await expect(page.getByTestId('perfil-nombre')).toHaveValue('');
    await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
  });

  test('«Pegar salida de $$» rellena $30, $32 y el tamaño', async ({ page }) => {
    await page.getByText('Pegar salida de $$').click();
    await page.getByTestId('pegar-dolar').fill('$30=255\n$31=0\n$32=1\n$130=300.000\n$131=200.000\nok');
    await page.getByTestId('leer-dolar').click();
    await expect(page.getByTestId('s-max')).toHaveValue('255');
    await expect(page.getByTestId('modo-32')).toHaveValue('1');
    await expect(page.getByTestId('cama-ancho')).toHaveValue('300');
    await expect(page.getByTestId('cama-alto')).toHaveValue('200');
    await expect(page.getByTestId('dolar-estado')).toHaveText('Listo: se llenaron 4 valores. Revísalos antes de guardar.');
  });

  test('«Pegar salida de $$» avisa si no hay valores de GRBL', async ({ page }) => {
    await page.getByText('Pegar salida de $$').click();
    await expect(page.getByTestId('pantalla-maquina')).toContainText(
      'Escribe $$ en la consola de tu máquina, copia todo lo que responda y pégalo aquí.',
    );
    await page.getByTestId('pegar-dolar').fill('hola, esto no es GRBL');
    await page.getByTestId('leer-dolar').click();
    await expect(page.getByTestId('dolar-estado')).toHaveText(
      'No encontré valores de GRBL en el texto. Copia la respuesta completa de $$.',
    );
    await expect(page.getByTestId('s-max')).toHaveValue('');
  });

  test('después de guardar, al recargar ya no aparece la pantalla', async ({ page }) => {
    await crearPerfil(page, CASOS[1].perfilPrueba);
    await expect(page.getByTestId('perfil-activo')).toHaveText(CASOS[1].perfilPrueba.nombre);
    await page.reload();
    await expect(page.getByTestId('app-principal')).toBeVisible();
    await expect(page.getByTestId('pantalla-maquina')).toBeHidden();
    await expect(page.getByTestId('perfil-activo')).toHaveText(CASOS[1].perfilPrueba.nombre);
  });
});

test.describe('perfiles', () => {
  test('«Máquina» edita el perfil; cancelar no cambia nada y un valor inválido no se guarda', async ({ page }) => {
    await crearPerfil(page, CASOS[0].perfilPrueba);
    await page.getByTestId('maquina').click();
    await expect(page.getByTestId('pantalla-maquina')).toBeVisible();
    await expect(page.getByTestId('s-max')).toHaveValue('1000');
    await page.getByTestId('s-max').fill('0');
    await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
    await page.getByTestId('cancelar-perfil').click();
    await expect(page.getByTestId('app-principal')).toBeVisible();
    await page.getByTestId('maquina').click();
    await expect(page.getByTestId('s-max')).toHaveValue('1000');
    await page.getByTestId('s-max').fill('500');
    await page.getByTestId('guardar-perfil').click();
    await expect(page.getByTestId('perfil-detalle')).toContainText('$30 = 500');
  });

  test('se puede crear un segundo perfil y queda activo', async ({ page }) => {
    await crearPerfil(page, CASOS[0].perfilPrueba);
    await page.getByTestId('maquina').click();
    await page.getByTestId('nuevo-perfil').click();
    await expect(page.getByTestId('perfil-nombre')).toHaveValue('');
    await llenarPerfil(page, CASOS[2].perfilPrueba);
    await page.getByTestId('guardar-perfil').click();
    await expect(page.getByTestId('perfil-activo')).toHaveText(CASOS[2].perfilPrueba.nombre);
    await page.reload();
    await expect(page.getByTestId('perfil-activo')).toHaveText(CASOS[2].perfilPrueba.nombre);
  });

  test('un perfil guardado dañado vuelve a la configuración y bloquea la exportación', async ({ page }) => {
    await page.evaluate(
      ([k, p]) => localStorage.setItem(k, JSON.stringify({ activo: 0, perfiles: [{ ...p, sMax: '-1' }] })),
      [CLAVE, CASOS[0].perfilPrueba] as const,
    );
    await page.reload();
    await expect(page.getByTestId('pantalla-maquina')).toBeVisible();
    await expect(page.getByTestId('exportar')).toBeHidden();
    await expect(page.getByTestId('guardar-perfil')).toBeDisabled();
  });

  test('la exportación se bloquea si el perfil guardado se daña después de generar', async ({ page }) => {
    await crearPerfil(page, CASOS[0].perfilPrueba);
    await page.getByTestId('generar').click();
    await expect(page.getByTestId('exportar')).toBeEnabled();
    await page.evaluate(
      ([k, p]) => localStorage.setItem(k, JSON.stringify({ activo: 0, perfiles: [{ ...p, sMax: 'abc' }] })),
      [CLAVE, CASOS[0].perfilPrueba] as const,
    );
    await page.getByTestId('exportar').click();
    await expect(page.getByTestId('estado')).toHaveText('Antes de exportar, configura tu máquina.');
    await expect(page.getByTestId('exportar')).toBeDisabled();
  });
});

for (const caso of CASOS) {
  test.describe(`perfil de prueba ${caso.perfil} (${caso.descripcion})`, () => {
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
      await crearPerfil(page, caso.perfilPrueba);
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
      comprobarArchivo(bytes, caso, `${info.project.name}_${caso.archivo}`);
    });

    test(`exporta ${caso.archivo} por la ruta de respaldo (descarga)`, async ({ page }, info) => {
      // Quita la API para forzar Blob + <a download>, como en Firefox.
      await page.evaluate(() => {
        delete (window as any).showSaveFilePicker;
        delete (Object.getPrototypeOf(window) as any).showSaveFilePicker;
      });
      expect(await page.evaluate(() => 'showSaveFilePicker' in window)).toBe(false);
      await crearPerfil(page, caso.perfilPrueba);
      await page.getByTestId('generar').click();
      const descarga = page.waitForEvent('download');
      await page.getByTestId('exportar').click();
      const d = await descarga;
      expect(d.suggestedFilename()).toBe('cuadricula_prueba.gcode');
      comprobarArchivo(readFileSync(await d.path()), caso, `${info.project.name}_respaldo_${caso.archivo}`);
    });
  });
}
