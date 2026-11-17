import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { RAIZ } from '../util';

const MUESTRAS = join(RAIZ, 'tests', 'muestras');
// Perfil de PRUEBA (no son los valores de la máquina de Angel): área 0..400 mm.
const PERFIL = { nombre: 'Prueba lienzo', sMax: '1000', laserMode32: '1', origen: 'inferior-izquierda', camaAncho: '400', camaAlto: '400' };

async function empezar(page: Page) {
  await page.goto('./');
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem('chopilaser.perfiles.v1', JSON.stringify({ activo: 0, perfiles: [p] }));
  }, PERFIL);
  await page.reload();
  await page.getByTestId('material-nuevo').fill('Material de prueba');
  await page.getByTestId('crear-material').click();
  await page.getByTestId('empezar-proyecto').click();
  await page.getByTestId('importar-diseno').setInputFiles(join(MUESTRAS, 'cuadrados.svg'));
  await expect(page.getByTestId('figura')).toHaveCount(2);
  // Se empieza sin selección.
  await page.getByTestId('lienzo').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sin-seleccion')).toBeVisible();
}

/** Punto de pantalla de un punto del diseño (mm). */
async function aPantalla(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      const area = document.querySelector('[data-testid="lienzo-area"]') as SVGGraphicsElement;
      const p = new DOMPoint(x, y).matrixTransform(area.getScreenCTM()!);
      return { x: p.x, y: p.y };
    },
    [x, y] as const,
  );
}

/** Punto de pantalla desplazado (dx, dy) mm del diseño. */
async function desplazar(page: Page, de: { x: number; y: number }, dx: number, dy: number) {
  const o = await aPantalla(page, 0, 0);
  const q = await aPantalla(page, dx, dy);
  return { x: de.x + q.x - o.x, y: de.y + q.y - o.y };
}

async function centroDe(page: Page, testid: string) {
  const b = (await page.getByTestId(testid).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function arrastrarRaton(page: Page, de: { x: number; y: number }, a: { x: number; y: number }, shift = false) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(de.x, de.y);
  await page.mouse.down();
  await page.mouse.move((de.x + a.x) / 2, (de.y + a.y) / 2, { steps: 4 });
  await page.mouse.move(a.x, a.y, { steps: 4 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

const num = async (page: Page, campo: string) => Number(await page.getByTestId(`prop-${campo}`).inputValue());

test.describe('lienzo con ratón', () => {
  test.beforeEach(async ({ page }) => empezar(page));

  test('seleccionar: clic, Mayús+clic, clic en vacío y recuadro', async ({ page }) => {
    const rojo = await aPantalla(page, 10, 80); // borde izquierdo del cuadrado rojo
    await page.mouse.click(rojo.x, rojo.y);
    await expect(page.getByTestId('marco-seleccion')).toHaveCount(1);
    expect(await num(page, 'x')).toBeCloseTo(10, 1);
    expect(await num(page, 'ancho')).toBeCloseTo(20, 1);
    await expect(page.getByTestId('prop-angulo')).toBeEnabled();
    const azul = await aPantalla(page, 60, 70);
    await page.keyboard.down('Shift');
    await page.mouse.click(azul.x, azul.y);
    await page.keyboard.up('Shift');
    expect(await num(page, 'ancho')).toBeCloseTo(60, 1); // caja de las dos: 10..70
    await expect(page.getByTestId('prop-angulo')).toBeDisabled();
    const vacio = await aPantalla(page, 200, 200);
    await page.mouse.click(vacio.x, vacio.y);
    await expect(page.getByTestId('sin-seleccion')).toBeVisible();
    // Recuadro que contiene las dos figuras.
    await arrastrarRaton(page, await aPantalla(page, 2, 100), await aPantalla(page, 80, 60));
    expect(await num(page, 'ancho')).toBeCloseTo(60, 1);
    // Recuadro que contiene solo la azul.
    await arrastrarRaton(page, await aPantalla(page, 42, 100), await aPantalla(page, 80, 60));
    expect(await num(page, 'x')).toBeCloseTo(50, 1);
    expect(await num(page, 'ancho')).toBeCloseTo(20, 1);
  });

  test('mover: arrastre y flechas', async ({ page }) => {
    await arrastrarRaton(page, await aPantalla(page, 10, 80), await aPantalla(page, 40, 120));
    expect(await num(page, 'x')).toBeCloseTo(40, 0);
    expect(await num(page, 'y')).toBeCloseTo(110, 0);
    await page.keyboard.press('ArrowRight');
    expect(await num(page, 'x')).toBeCloseTo(41, 0);
    await page.keyboard.press('Shift+ArrowUp');
    expect(await num(page, 'y')).toBeCloseTo(120, 0);
  });

  test('escalar: tirador libre y proporcional con Mayús', async ({ page }) => {
    const rojo = await aPantalla(page, 10, 80);
    await page.mouse.click(rojo.x, rojo.y);
    // Esquina superior derecha (30, 90) +20, +10 mm: 40 x 30, la esquina opuesta (10, 70) queda fija.
    let t = await centroDe(page, 'tirador-1_1');
    await arrastrarRaton(page, t, await desplazar(page, t, 20, 10));
    expect(Math.abs(await num(page, 'ancho') - 40)).toBeLessThan(1.5); // ~1 px de redondeo
    expect(Math.abs(await num(page, 'alto') - 30)).toBeLessThan(1.5); // ~1 px de redondeo
    expect(await num(page, 'x')).toBeCloseTo(10, 0);
    expect(await num(page, 'y')).toBeCloseTo(70, 0);
    // Proporcional: de 40x30, +40 mm en X -> factor max(80/40, 30/30) = 2 -> 80 x 60.
    t = await centroDe(page, 'tirador-1_1');
    await arrastrarRaton(page, t, await desplazar(page, t, 40, 0), true);
    const ancho = await num(page, 'ancho');
    const alto = await num(page, 'alto');
    expect(ancho / alto).toBeCloseTo(4 / 3, 1);
    expect(Math.abs(ancho - 80)).toBeLessThan(1.5); // ~1 px de redondeo
  });

  test('girar: tirador libre y de 15° en 15° con Mayús', async ({ page }) => {
    const rojo = await aPantalla(page, 10, 80);
    await page.mouse.click(rojo.x, rojo.y);
    // Centro (20, 80). El tirador está arriba; llevarlo a la izquierda gira +90°.
    await arrastrarRaton(page, await centroDe(page, 'tirador-giro'), await aPantalla(page, -10, 80));
    expect(Math.abs(await num(page, 'angulo') - 90)).toBeLessThan(2);
    await arrastrarRaton(page, await centroDe(page, 'tirador-giro'), await aPantalla(page, 0, 60), true);
    const a = await num(page, 'angulo');
    expect(Math.abs(a / 15 - Math.round(a / 15))).toBeLessThan(1e-6);
    expect(a).toBeGreaterThan(90);
  });

  test('campos numéricos y borrar', async ({ page }) => {
    const rojo = await aPantalla(page, 10, 80);
    await page.mouse.click(rojo.x, rojo.y);
    await page.getByTestId('prop-ancho').fill('40');
    await page.getByTestId('prop-ancho').press('Enter');
    expect(await num(page, 'alto')).toBeCloseTo(40, 3);
    await page.getByTestId('prop-x').fill('100');
    await page.getByTestId('prop-x').press('Enter');
    await page.getByTestId('prop-y').fill('150');
    await page.getByTestId('prop-y').press('Enter');
    expect(await num(page, 'x')).toBeCloseTo(100, 3);
    expect(await num(page, 'y')).toBeCloseTo(150, 3);
    await page.getByTestId('prop-angulo').fill('45');
    await page.getByTestId('prop-angulo').press('Enter');
    expect(await num(page, 'angulo')).toBeCloseTo(45, 3);
    expect(await num(page, 'x')).toBeCloseTo(100, 3); // la esquina se mantiene
    await page.getByTestId('borrar').click();
    await expect(page.getByTestId('figura')).toHaveCount(1);
    const azul = await aPantalla(page, 50, 80);
    await page.mouse.click(azul.x, azul.y);
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('figura')).toHaveCount(0);
  });
});

test.describe('lienzo táctil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  /** Arrastre táctil real (Chromium, CDP): genera pointer events con pointerType «touch». */
  async function arrastrarDedo(page: Page, de: { x: number; y: number }, a: { x: number; y: number }) {
    const cdp = await page.context().newCDPSession(page);
    const pasos = 8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: de.x, y: de.y }] });
    for (let i = 1; i <= pasos; i++) {
      const x = de.x + ((a.x - de.x) * i) / pasos;
      const y = de.y + ((a.y - de.y) * i) / pasos;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  test('tocar, mover, escalar y girar con el dedo', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium', 'El arrastre táctil usa CDP (solo Chromium).');
    await empezar(page);
    await page.getByTestId('lienzo').scrollIntoViewIfNeeded();
    const rojo = await aPantalla(page, 20, 80);
    await page.touchscreen.tap(rojo.x, rojo.y);
    await expect(page.getByTestId('marco-seleccion')).toHaveCount(1);
    expect(await num(page, 'x')).toBeCloseTo(10, 0);
    // Mover 50 mm a la derecha.
    await arrastrarDedo(page, await aPantalla(page, 20, 80), await aPantalla(page, 70, 80));
    expect(Math.abs((await num(page, 'x')) - 60)).toBeLessThan(2);
    // Escalar desde la esquina superior derecha: +20, +20 mm.
    const t = await centroDe(page, 'tirador-1_1');
    await arrastrarDedo(page, t, await desplazar(page, t, 20, 20));
    expect(Math.abs((await num(page, 'ancho')) - 40)).toBeLessThan(3);
    // Girar: tirador hacia la izquierda del centro.
    const c = { x: (await num(page, 'x')) + (await num(page, 'ancho')) / 2, y: (await num(page, 'y')) + (await num(page, 'alto')) / 2 };
    await arrastrarDedo(page, await centroDe(page, 'tirador-giro'), await aPantalla(page, c.x - 60, c.y));
    expect(Math.abs((await num(page, 'angulo')) - 90)).toBeLessThan(5);
  });
});
