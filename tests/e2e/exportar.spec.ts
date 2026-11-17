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

const AVISO_GUARDAR = 'Completa los campos marcados para continuar.';
const ERRORES_CAMPO = ['nombre', 'sMax', 'camaAncho', 'camaAlto', 'origen', 'xMin', 'yMin', 'xMax', 'yMax'];

/** Pulsa «Guardar y empezar» con datos no válidos: no guarda y sigue en la pantalla. */
async function guardarBloqueado(page: Page) {
  const antes = await page.evaluate((k) => localStorage.getItem(k), CLAVE);
  await expect(page.getByTestId('guardar-perfil')).toBeEnabled();
  await page.getByTestId('guardar-perfil').click();
  await expect(page.getByTestId('pantalla-maquina')).toBeVisible();
  await expect(page.getByTestId('app-principal')).toBeHidden();
  await expect(page.getByTestId('errores')).toHaveText(AVISO_GUARDAR);
  expect(await page.evaluate((k) => localStorage.getItem(k), CLAVE)).toBe(antes);
}

async function sinErroresVisibles(page: Page) {
  for (const c of ERRORES_CAMPO) await expect(page.getByTestId(`error-${c}`)).toHaveText('');
  await expect(page.getByTestId('errores')).toHaveText('');
  await expect(page.locator('#pantalla-maquina [aria-invalid="true"]')).toHaveCount(0);
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
    for (const id of ['modo-32', 'origen']) {
      await expect(page.getByTestId(id).locator('option').first()).toHaveText('Elige una opción');
      await expect(page.getByTestId(id).locator('option:checked')).toHaveText('Elige una opción');
    }
    await expect(page.getByTestId('origen').locator('option[value="personalizada"]')).toHaveText(
      'Avanzado: área por coordenadas (mm)',
    );
    await expect(page.getByTestId('ayuda-avanzado')).toBeHidden();
  });

  test('al cargar no se muestra ningún error', async ({ page }) => {
    await expect(page.getByTestId('pantalla-maquina')).toBeVisible();
    await sinErroresVisibles(page);
    await expect(page.getByTestId('pantalla-maquina')).not.toContainText('Este dato hace falta.');
    await expect(page.getByTestId('guardar-perfil')).toBeEnabled();
  });

  test('el error de un campo vacío aparece al salir de él', async ({ page }) => {
    await page.getByTestId('s-max').focus();
    await expect(page.getByTestId('error-sMax')).toHaveText('');
    await page.getByTestId('s-max').blur();
    await expect(page.getByTestId('error-sMax')).toHaveText('Este dato hace falta.');
    await expect(page.getByTestId('s-max')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('s-max')).toHaveAttribute('aria-describedby', /\berror-sMax\b/);
    // Solo ese campo: los que no se tocaron siguen sin error, y no hay aviso general.
    await expect(page.getByTestId('error-camaAncho')).toHaveText('');
    await expect(page.getByTestId('errores')).toHaveText('');
    // Al corregirlo, el error desaparece.
    await page.getByTestId('s-max').fill('1000');
    await expect(page.getByTestId('error-sMax')).toHaveText('');
    await expect(page.getByTestId('s-max')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('al guardar con campos vacíos se ven todos los errores y el foco va al primero', async ({ page }) => {
    await page.getByTestId('preset-grbl').click(); // $30 queda lleno
    await guardarBloqueado(page);
    const esperados: [string, string][] = [
      ['nombre', 'perfil-nombre'],
      ['camaAncho', 'cama-ancho'],
      ['camaAlto', 'cama-alto'],
      ['origen', 'origen'],
    ];
    for (const [c, id] of esperados) {
      await expect(page.getByTestId(`error-${c}`)).toHaveText('Este dato hace falta.');
      await expect(page.getByTestId(id)).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByTestId(id)).toHaveAttribute('aria-describedby', new RegExp(`\\berror-${c}\\b`));
    }
    await expect(page.getByTestId('error-sMax')).toHaveText('');
    await expect(page.getByTestId('perfil-nombre')).toBeFocused();
    // Con el nombre lleno, el foco va al siguiente campo con error.
    await page.getByTestId('perfil-nombre').fill('Prueba');
    await page.getByTestId('guardar-perfil').click();
    await expect(page.getByTestId('cama-ancho')).toBeFocused();
    await expect(page.getByTestId('errores')).toHaveText(AVISO_GUARDAR);
  });

  const valido = { nombre: 'Prueba', sMax: '1000', laserMode32: '', origen: 'inferior-izquierda', camaAncho: '400', camaAlto: '400' };
  for (const [campo, id] of [
    ['sMax', 's-max'],
    ['camaAncho', 'cama-ancho'],
    ['camaAlto', 'cama-alto'],
  ] as const) {
    test(`valores no válidos en ${campo} bloquean el guardado`, async ({ page }) => {
      await llenarPerfil(page, valido);
      for (const v of ['', '0', '-5', 'abc', 'NaN']) {
        await page.getByTestId(id).fill(v);
        await guardarBloqueado(page);
        await expect(page.getByTestId(`error-${campo}`)).toHaveText(
          v === '' ? 'Este dato hace falta.' : 'Escribe un número mayor que 0.',
        );
        await expect(page.getByTestId(id)).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByTestId(id)).toBeFocused();
      }
      expect(await page.evaluate((k) => localStorage.getItem(k), CLAVE)).toBe(null);
      await page.getByTestId(id).fill('100');
      await expect(page.getByTestId('errores')).toHaveText('');
      await page.getByTestId('guardar-perfil').click();
      await expect(page.getByTestId('app-principal')).toBeVisible();
    });
  }

  test('sin nombre o sin origen no se puede guardar', async ({ page }) => {
    await llenarPerfil(page, { ...valido, nombre: '   ' });
    await guardarBloqueado(page);
    await expect(page.getByTestId('perfil-nombre')).toBeFocused();
    await page.getByTestId('perfil-nombre').fill('Prueba');
    await page.getByTestId('origen').selectOption('');
    await guardarBloqueado(page);
    await expect(page.getByTestId('origen')).toBeFocused();
  });

  test('área personalizada no válida bloquea el guardado', async ({ page }) => {
    await llenarPerfil(page, { nombre: 'P', sMax: '1', origen: 'personalizada', xMin: '0', yMin: '0', xMax: '10', yMax: '10' });
    await expect(page.getByTestId('ayuda-avanzado')).toHaveText(
      'Para máquinas que quedan en coordenadas negativas después del homing.',
    );
    await expect(page.getByTestId('cama-ancho')).toBeHidden();
    await page.getByTestId('x-max').fill('-1');
    await guardarBloqueado(page);
    await expect(page.getByTestId('x-max')).toBeFocused();
    await page.getByTestId('x-max').fill('abc');
    await guardarBloqueado(page);
    await expect(page.getByTestId('error-xMax')).toHaveText('Escribe un número.');
  });

  test('el botón de GRBL 1.1 llena solo $30=1000 y $32=0', async ({ page }) => {
    await expect(page.getByTestId('preset-grbl')).toHaveText('Usar valores de fábrica de GRBL 1.1');
    await expect(page.getByTestId('ayuda-preset')).toHaveText(
      'Llena $30=1000 y $32=0. El nombre, el área y el origen los pones tú.',
    );
    await expect(page.getByTestId('ayuda-preset').locator('code')).toHaveText(['$30=1000', '$32=0']);
    await page.getByTestId('preset-grbl').click();
    await expect(page.getByTestId('s-max')).toHaveValue('1000');
    await expect(page.getByTestId('modo-32')).toHaveValue('0');
    // El área, el origen y el nombre no se suponen.
    await expect(page.getByTestId('cama-ancho')).toHaveValue('');
    await expect(page.getByTestId('cama-alto')).toHaveValue('');
    await expect(page.getByTestId('origen')).toHaveValue('');
    await expect(page.getByTestId('perfil-nombre')).toHaveValue('');
    await guardarBloqueado(page);
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

  test('«Pegar salida de $$»: singular, $23 como dato y números estrictos', async ({ page }) => {
    await page.getByText('Pegar salida de $$').click();
    await page.getByTestId('pegar-dolar').fill('$30=1e3\n$130=4.0.0\n$131=150\nok');
    await page.getByTestId('leer-dolar').click();
    await expect(page.getByTestId('dolar-estado')).toHaveText('Listo: se llenó 1 valor. Revísalo antes de guardar.');
    await expect(page.getByTestId('s-max')).toHaveValue('');
    await expect(page.getByTestId('cama-ancho')).toHaveValue('');
    await expect(page.getByTestId('cama-alto')).toHaveValue('150');
    await expect(page.getByTestId('homing-23')).toHaveAttribute('readonly', '');
    await page.getByTestId('pegar-dolar').fill('$23=3\n$30=1000\n$130=400\nok');
    await page.getByTestId('leer-dolar').click();
    await expect(page.getByTestId('dolar-estado')).toHaveText('Listo: se llenaron 3 valores. Revísalos antes de guardar.');
    await expect(page.getByTestId('homing-23')).toHaveValue('3');
    await page.getByTestId('perfil-nombre').fill('Con $23');
    await page.getByTestId('origen').selectOption('inferior-izquierda');
    await page.getByTestId('guardar-perfil').click();
    await expect(page.getByTestId('app-principal')).toBeVisible();
    const guardado = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), CLAVE);
    expect(guardado.perfiles[0].homing23).toBe('3');
    await page.getByTestId('maquina').click();
    await expect(page.getByTestId('homing-23')).toHaveValue('3');
  });

  test('coma decimal y topes muestran su error y bloquean el guardado', async ({ page }) => {
    await llenarPerfil(page, { ...valido, sMax: '1,000' });
    await guardarBloqueado(page);
    await expect(page.getByTestId('error-sMax')).toHaveText('Escribe un número.');
    await page.getByTestId('s-max').fill('100001');
    await expect(page.getByTestId('error-sMax')).toHaveText('Escribe un número entre 0 y 100000.');
    await page.getByTestId('s-max').fill('100000');
    await page.getByTestId('cama-ancho').fill('5001');
    await expect(page.getByTestId('error-camaAncho')).toHaveText('Escribe un número entre 0 y 5000.');
    await guardarBloqueado(page);
    await page.getByTestId('cama-ancho').fill('5000');
    await page.getByTestId('guardar-perfil').click();
    await expect(page.getByTestId('app-principal')).toBeVisible();
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
    await sinErroresVisibles(page);
    await page.getByTestId('s-max').fill('0');
    await guardarBloqueado(page);
    await expect(page.getByTestId('error-sMax')).toHaveText('Escribe un número mayor que 0.');
    await expect(page.getByTestId('s-max')).toBeFocused();
    await page.getByTestId('cancelar-perfil').click();
    await expect(page.getByTestId('app-principal')).toBeVisible();
    await page.getByTestId('maquina').click();
    await expect(page.getByTestId('s-max')).toHaveValue('1000');
    // Al volver a abrir «Máquina» no quedan errores del intento anterior.
    await sinErroresVisibles(page);
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
    await guardarBloqueado(page);
    await expect(page.getByTestId('error-sMax')).toHaveText('Escribe un número mayor que 0.');
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

test.describe('estilo', () => {
  for (const ancho of [1280, 390]) {
    test(`sin desbordamiento horizontal a ${ancho} px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 844 });
      const sinDesborde = async () =>
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      await sinDesborde();
      await page.getByTestId('origen').selectOption('personalizada');
      await sinDesborde();
      await crearPerfil(page, CASOS[0].perfilPrueba);
      await page.getByTestId('generar').click();
      await sinDesborde();
    });
  }

  test('Rajdhani se sirve desde la app, sin CDN', async ({ page }) => {
    const externas: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('http://127.0.0.1')) externas.push(r.url());
    });
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('600 16px Rajdhani'))).toBe(true);
    expect(externas).toEqual([]);
  });
});

test.describe('consola', () => {
  test('al cargar no hay avisos ni errores en la consola', async ({ browser, baseURL }) => {
    // Contexto nuevo y escucha antes de la primera carga: así el navegador decodifica
    // las fuentes desde cero (Firefox avisaba «downloadable font: glyf: Glyph bbox was incorrect»).
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    const mensajes: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') mensajes.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => mensajes.push(`pageerror: ${e.message}`));
    await page.goto('./');
    await page.evaluate(() =>
      Promise.all(['500', '600', '700'].map((w) => document.fonts.load(`${w} 16px Rajdhani`))),
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    expect(mensajes).toEqual([]);
    await ctx.close();
  });
});

test.describe('dos pestañas', () => {
  async function exportarDescarga(page: Page): Promise<Buffer> {
    await page.evaluate(() => {
      delete (window as any).showSaveFilePicker;
      delete (Object.getPrototypeOf(window) as any).showSaveFilePicker;
    });
    const d = page.waitForEvent('download');
    await page.getByTestId('exportar').click();
    return readFileSync(await (await d).path());
  }

  test('un cambio de perfil en otra pestaña invalida la cuadrícula y actualiza el perfil', async ({ page, context }) => {
    await crearPerfil(page, CASOS[0].perfilPrueba);
    await page.getByTestId('generar').click();
    await expect(page.getByTestId('exportar')).toBeEnabled();

    const otra = await context.newPage();
    await otra.goto('./');
    await expect(otra.getByTestId('perfil-activo')).toHaveText(CASOS[0].perfilPrueba.nombre);
    await otra.getByTestId('maquina').click();
    await otra.getByTestId('nuevo-perfil').click();
    await llenarPerfil(otra, CASOS[1].perfilPrueba);
    await otra.getByTestId('guardar-perfil').click();
    await expect(otra.getByTestId('perfil-activo')).toHaveText(CASOS[1].perfilPrueba.nombre);

    // La primera pestaña se entera por el evento storage.
    await expect(page.getByTestId('perfil-activo')).toHaveText(CASOS[1].perfilPrueba.nombre);
    await expect(page.getByTestId('perfil-detalle')).toContainText('$30 = 255');
    await expect(page.getByTestId('exportar')).toBeDisabled();
    await expect(page.getByTestId('salida')).toHaveValue('');
    await expect(page.getByTestId('estado')).toHaveText('El perfil cambió en otra pestaña. Vuelve a generar la cuadrícula.');

    await page.getByTestId('generar').click();
    comprobarArchivo(await exportarDescarga(page), CASOS[1], `${test.info().project.name}_dos_pestanas.gcode`);
    await otra.close();
  });

  test('exportar siempre regenera con el perfil guardado, aunque no llegue el evento', async ({ page }) => {
    await crearPerfil(page, CASOS[0].perfilPrueba);
    await page.getByTestId('generar').click();
    // Cambia el perfil activo sin evento storage (en la misma pestaña no se dispara).
    await page.evaluate(
      ([k, a, b]) => localStorage.setItem(k, JSON.stringify({ activo: 1, perfiles: [a, b] })),
      [CLAVE, CASOS[0].perfilPrueba, CASOS[1].perfilPrueba] as const,
    );
    const bytes = await exportarDescarga(page);
    comprobarArchivo(bytes, CASOS[1], `${test.info().project.name}_regenera.gcode`);
    await expect(page.getByTestId('perfil-activo')).toHaveText(CASOS[1].perfilPrueba.nombre);
    await expect(page.getByTestId('salida')).toHaveValue(/S maximo \(\$30\): 255/);
  });
});

test.describe('perfiles en .json', () => {
  test('exportar e importar perfiles', async ({ page }) => {
    await crearPerfil(page, CASOS[0].perfilPrueba);
    await page.getByTestId('maquina').click();
    await expect(page.getByTestId('exportar-perfiles')).toBeEnabled();
    const d = page.waitForEvent('download');
    await page.getByTestId('exportar-perfiles').click();
    const descarga = await d;
    expect(descarga.suggestedFilename()).toBe('chopilaser-perfiles.json');
    const json = JSON.parse(readFileSync(await descarga.path(), 'utf8'));
    expect(json).toMatchObject({ formato: 'chopilaser-perfiles', version: 1, activo: 0 });
    expect(json.perfiles).toHaveLength(1);
    expect(json.perfiles[0].nombre).toBe(CASOS[0].perfilPrueba.nombre);

    // Otro navegador vacío: se importa el archivo desde la primera pantalla.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('pantalla-maquina')).toBeVisible();
    await expect(page.getByTestId('exportar-perfiles')).toBeDisabled();
    const otro = { ...json, activo: 1, perfiles: [...json.perfiles, CASOS[1].perfilPrueba] };
    await page.getByTestId('importar-archivo').setInputFiles({
      name: 'perfiles.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(otro)),
    });
    await expect(page.getByTestId('perfiles-estado')).toHaveText('Se importaron 2 perfiles.');
    await expect(page.getByTestId('perfil-select').locator('option')).toHaveText([
      CASOS[0].perfilPrueba.nombre,
      CASOS[1].perfilPrueba.nombre,
    ]);
    await page.getByTestId('cancelar-perfil').click();
    await expect(page.getByTestId('perfil-activo')).toHaveText(CASOS[1].perfilPrueba.nombre);
  });

  test('un archivo con un perfil no válido se rechaza entero, con error visible', async ({ page }) => {
    await crearPerfil(page, CASOS[0].perfilPrueba);
    const antes = await page.evaluate((k) => localStorage.getItem(k), CLAVE);
    await page.getByTestId('maquina').click();
    const malo = {
      formato: 'chopilaser-perfiles',
      version: 1,
      activo: 0,
      perfiles: [CASOS[1].perfilPrueba, { ...CASOS[2].perfilPrueba, sMax: '1,000' }],
    };
    await page.getByTestId('importar-archivo').setInputFiles({
      name: 'malo.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(malo)),
    });
    await expect(page.getByTestId('perfiles-estado')).toHaveText(
      'No se importó nada: el perfil 2 no es válido (Potencia máxima ($30): Escribe un número.)',
    );
    await expect(page.getByTestId('perfiles-estado')).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), CLAVE)).toBe(antes);
    await page.getByTestId('importar-archivo').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await expect(page.getByTestId('perfiles-estado')).toHaveText('No se importó nada: el archivo no es JSON válido.');
  });

  test('localStorage dañado muestra un aviso visible y se conserva una copia al guardar', async ({ page }) => {
    await page.evaluate((k) => localStorage.setItem(k, '{no es json'), CLAVE);
    await page.reload();
    await expect(page.getByTestId('pantalla-maquina')).toBeVisible();
    await expect(page.getByTestId('aviso-almacen')).toBeVisible();
    await expect(page.getByTestId('aviso-almacen')).toContainText('dañados');
    await llenarPerfil(page, CASOS[0].perfilPrueba);
    await page.getByTestId('guardar-perfil').click();
    await expect(page.getByTestId('app-principal')).toBeVisible();
    await expect(page.getByTestId('aviso-almacen')).toBeHidden();
    expect(await page.evaluate((k) => localStorage.getItem(k + '.danado'), CLAVE)).toBe('{no es json');
  });
});
