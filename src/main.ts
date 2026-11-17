import './estilo.css';
import {
  CUADRICULA_PREDETERMINADA,
  ErrorGcode,
  generarCuadricula,
  generarGcode,
  tamanoCuadricula,
  validarConfigMaquina,
  type ConfigMaquina,
  type ConfigMaquinaCruda,
} from './gcode';
import { exportarGcode } from './exportar';

const CLAVE = 'chopilaser.maquina.v1';

function leerGuardado(): ConfigMaquinaCruda {
  try {
    const t = localStorage.getItem(CLAVE);
    const o = t ? (JSON.parse(t) as unknown) : null;
    return o && typeof o === 'object' ? (o as ConfigMaquinaCruda) : {};
  } catch {
    return {};
  }
}

function texto(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

const t = tamanoCuadricula(CUADRICULA_PREDETERMINADA);
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header>
    <h1>ChopiLaser <small>(nombre provisional)</small></h1>
    <p>Genera G-code para láser GRBL y guárdalo en la tarjeta SD.</p>
  </header>
  <section aria-labelledby="t-maquina">
    <h2 id="t-maquina">Máquina</h2>
    <p class="nota">Copia estos valores de la configuración de tu máquina. No hay valores por defecto.</p>
    <form id="form-maquina" novalidate>
      <label>S máximo ($30) <input id="s-max" data-testid="s-max" inputmode="decimal" autocomplete="off" required /></label>
      <label>Ancho de la cama (mm) <input id="cama-ancho" data-testid="cama-ancho" inputmode="decimal" autocomplete="off" required /></label>
      <label>Alto de la cama (mm) <input id="cama-alto" data-testid="cama-alto" inputmode="decimal" autocomplete="off" required /></label>
      <label>Modo láser ($32)
        <select id="modo-32" data-testid="modo-32">
          <option value="">Sin especificar</option>
          <option value="0">0 (desactivado)</option>
          <option value="1">1 (activado)</option>
        </select>
      </label>
    </form>
    <ul id="errores" data-testid="errores" class="errores" role="alert"></ul>
  </section>
  <section aria-labelledby="t-cuadricula">
    <h2 id="t-cuadricula">Cuadrícula de prueba</h2>
    <p class="nota">Cuadros de potencia (${CUADRICULA_PREDETERMINADA.potencias.join(', ')} %) por velocidad
      (${CUADRICULA_PREDETERMINADA.velocidades.join(', ')} mm/min), en M3 y en M4. Ocupa ${t.ancho} x ${t.alto} mm desde el origen.</p>
    <button id="generar" data-testid="generar" type="button">Generar cuadrícula de prueba</button>
    <button id="exportar" data-testid="exportar" type="button" disabled>Exportar .gcode</button>
    <p id="estado" data-testid="estado" role="status"></p>
    <textarea id="salida" data-testid="salida" readonly rows="16" spellcheck="false" aria-label="G-code generado"></textarea>
  </section>
  <footer><p>Software libre bajo licencia GPLv3 o posterior.</p></footer>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sMax = $<HTMLInputElement>('s-max');
const ancho = $<HTMLInputElement>('cama-ancho');
const alto = $<HTMLInputElement>('cama-alto');
const modo32 = $<HTMLSelectElement>('modo-32');
const errores = $<HTMLUListElement>('errores');
const btnGenerar = $<HTMLButtonElement>('generar');
const btnExportar = $<HTMLButtonElement>('exportar');
const estado = $<HTMLParagraphElement>('estado');
const salida = $<HTMLTextAreaElement>('salida');

const guardado = leerGuardado();
sMax.value = texto(guardado.sMax);
ancho.value = texto(guardado.camaAncho);
alto.value = texto(guardado.camaAlto);
modo32.value = texto(guardado.laserMode32) === '0' || texto(guardado.laserMode32) === '1' ? texto(guardado.laserMode32) : '';

let gcode: string | null = null;

function configActual(): ConfigMaquina | null {
  const cruda: ConfigMaquinaCruda = {
    sMax: sMax.value,
    camaAncho: ancho.value,
    camaAlto: alto.value,
    laserMode32: modo32.value,
  };
  try {
    localStorage.setItem(CLAVE, JSON.stringify(cruda));
  } catch {
    /* almacenamiento no disponible: se sigue sin guardar */
  }
  const r = validarConfigMaquina(cruda);
  errores.replaceChildren(
    ...(r.ok ? [] : r.errores).map((e) => {
      const li = document.createElement('li');
      li.textContent = e;
      return li;
    }),
  );
  return r.ok ? r.config : null;
}

function actualizar(): void {
  const cfg = configActual();
  // Cualquier cambio en la máquina invalida el G-code ya generado.
  gcode = null;
  salida.value = '';
  btnGenerar.disabled = cfg === null;
  btnExportar.disabled = true;
  estado.textContent = cfg ? '' : 'Completa la configuración de la máquina para generar y exportar.';
}

for (const el of [sMax, ancho, alto, modo32]) el.addEventListener('input', actualizar);
modo32.addEventListener('change', actualizar);

btnGenerar.addEventListener('click', () => {
  const cfg = configActual();
  if (!cfg) return actualizar();
  try {
    const trabajo = generarCuadricula({ ancho: cfg.camaAncho, alto: cfg.camaAlto });
    gcode = generarGcode(trabajo, cfg);
    salida.value = gcode;
    btnExportar.disabled = false;
    estado.textContent = `Cuadrícula generada: ${gcode.split('\n').length - 1} líneas.`;
  } catch (e) {
    gcode = null;
    salida.value = '';
    btnExportar.disabled = true;
    estado.textContent = e instanceof ErrorGcode ? e.message : 'Error inesperado al generar el G-code.';
  }
});

btnExportar.addEventListener('click', async () => {
  // Se vuelve a validar justo antes de exportar.
  if (!configActual() || gcode === null) {
    btnExportar.disabled = true;
    estado.textContent = 'Exportación bloqueada: la configuración de la máquina no es válida.';
    return;
  }
  try {
    const ruta = await exportarGcode(gcode, 'cuadricula_prueba.gcode');
    estado.textContent =
      ruta === 'selector' ? 'Archivo guardado.' : ruta === 'descarga' ? 'Archivo descargado.' : 'Exportación cancelada.';
    estado.dataset.ruta = ruta;
  } catch {
    estado.textContent = 'No se pudo guardar el archivo.';
  }
});

actualizar();
