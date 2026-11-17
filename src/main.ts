import './estilo.css';
import {
  CUADRICULA_PREDETERMINADA,
  ErrorGcode,
  ORIGENES,
  PRESET_GRBL11,
  generarCuadricula,
  generarGcode,
  leerSalidaDolarDolar,
  milesimasCortas,
  aMilesimas,
  tamanoArea,
  tamanoCuadricula,
  validarPerfil,
  type Perfil,
  type PerfilCrudo,
} from './gcode';
import { exportarGcode } from './exportar';
import { escribirAlmacen, leerAlmacen, perfilActivo, type Almacen } from './perfiles';

const t = tamanoCuadricula(CUADRICULA_PREDETERMINADA);
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header>
    <h1>ChopiLaser <small>(nombre provisional)</small></h1>
  </header>

  <section id="pantalla-maquina" data-testid="pantalla-maquina" aria-labelledby="t-maquina" hidden>
    <h2 id="t-maquina">Configuración de la máquina</h2>
    <p class="nota" id="intro-maquina"></p>
    <div id="fila-perfiles" class="fila" hidden>
      <label>Perfil <select id="perfil-select" data-testid="perfil-select"></select></label>
      <button id="nuevo-perfil" data-testid="nuevo-perfil" type="button">Nuevo perfil</button>
    </div>
    <div class="fila">
      <button id="preset-grbl" data-testid="preset-grbl" type="button">Valores de fábrica de GRBL 1.1</button>
    </div>
    <details id="caja-dolar">
      <summary>Pegar salida de $$</summary>
      <p class="nota">Pega aquí lo que responde la máquina al comando <code>$$</code>. Se leen $30, $32, $130 y $131.</p>
      <textarea id="pegar-dolar" data-testid="pegar-dolar" rows="6" spellcheck="false" aria-label="Pegar salida de $$"></textarea>
      <button id="leer-dolar" data-testid="leer-dolar" type="button">Leer valores</button>
    </details>
    <form id="form-maquina" novalidate>
      <fieldset>
        <legend>Perfil</legend>
        <label>Nombre del perfil <input id="perfil-nombre" data-testid="perfil-nombre" autocomplete="off" /></label>
      </fieldset>
      <fieldset>
        <legend>Parámetros de la máquina</legend>
        <label>S máximo ($30) <input id="s-max" data-testid="s-max" inputmode="decimal" autocomplete="off" /></label>
        <label>Modo láser ($32)
          <select id="modo-32" data-testid="modo-32">
            <option value="">Sin especificar</option>
            <option value="0">0 (desactivado)</option>
            <option value="1">1 (activado)</option>
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend>Área de trabajo</legend>
        <label>Esquina del origen (0,0)
          <select id="origen" data-testid="origen">
            <option value="">Elige…</option>
            ${ORIGENES.map((o) => `<option value="${o.valor}">${o.texto}</option>`).join('')}
          </select>
        </label>
        <div id="campos-cama" class="rejilla">
          <label>Ancho (mm) <input id="cama-ancho" data-testid="cama-ancho" inputmode="decimal" autocomplete="off" /></label>
          <label>Alto (mm) <input id="cama-alto" data-testid="cama-alto" inputmode="decimal" autocomplete="off" /></label>
        </div>
        <div id="campos-area" class="rejilla" hidden>
          <label>xmin (mm) <input id="x-min" data-testid="x-min" inputmode="decimal" autocomplete="off" /></label>
          <label>ymin (mm) <input id="y-min" data-testid="y-min" inputmode="decimal" autocomplete="off" /></label>
          <label>xmax (mm) <input id="x-max" data-testid="x-max" inputmode="decimal" autocomplete="off" /></label>
          <label>ymax (mm) <input id="y-max" data-testid="y-max" inputmode="decimal" autocomplete="off" /></label>
        </div>
        <p id="area-resumen" data-testid="area-resumen" class="nota"></p>
      </fieldset>
    </form>
    <ul id="errores" data-testid="errores" class="errores" role="alert"></ul>
    <button id="guardar-perfil" data-testid="guardar-perfil" type="button" disabled>Guardar perfil</button>
    <button id="cancelar-perfil" data-testid="cancelar-perfil" type="button" hidden>Cancelar</button>
  </section>

  <main id="app-principal" data-testid="app-principal" hidden>
    <div class="fila">
      <p>Perfil: <strong id="perfil-activo" data-testid="perfil-activo"></strong> <span id="perfil-detalle" data-testid="perfil-detalle" class="nota"></span></p>
      <button id="maquina" data-testid="maquina" type="button">Máquina</button>
    </div>
    <section aria-labelledby="t-cuadricula">
      <h2 id="t-cuadricula">Cuadrícula de prueba</h2>
      <p class="nota">Cuadros de potencia (${CUADRICULA_PREDETERMINADA.potencias.join(', ')} %) por velocidad
        (${CUADRICULA_PREDETERMINADA.velocidades.join(', ')} mm/min), en M3 y en M4. Ocupa ${t.ancho} x ${t.alto} mm
        desde la esquina inferior izquierda del área de trabajo.</p>
      <button id="generar" data-testid="generar" type="button">Generar cuadrícula de prueba</button>
      <button id="exportar" data-testid="exportar" type="button" disabled>Exportar .gcode</button>
      <p id="estado" data-testid="estado" role="status"></p>
      <textarea id="salida" data-testid="salida" readonly rows="16" spellcheck="false" aria-label="G-code generado"></textarea>
    </section>
  </main>
  <footer><p>Software libre bajo licencia GPLv3 o posterior.</p></footer>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pantalla = $<HTMLElement>('pantalla-maquina');
const principal = $<HTMLElement>('app-principal');
const intro = $<HTMLParagraphElement>('intro-maquina');
const filaPerfiles = $<HTMLDivElement>('fila-perfiles');
const perfilSelect = $<HTMLSelectElement>('perfil-select');
const campos = {
  nombre: $<HTMLInputElement>('perfil-nombre'),
  sMax: $<HTMLInputElement>('s-max'),
  laserMode32: $<HTMLSelectElement>('modo-32'),
  origen: $<HTMLSelectElement>('origen'),
  camaAncho: $<HTMLInputElement>('cama-ancho'),
  camaAlto: $<HTMLInputElement>('cama-alto'),
  xMin: $<HTMLInputElement>('x-min'),
  yMin: $<HTMLInputElement>('y-min'),
  xMax: $<HTMLInputElement>('x-max'),
  yMax: $<HTMLInputElement>('y-max'),
};
type Campo = keyof typeof campos;
const camposCama = $<HTMLDivElement>('campos-cama');
const camposArea = $<HTMLDivElement>('campos-area');
const areaResumen = $<HTMLParagraphElement>('area-resumen');
const errores = $<HTMLUListElement>('errores');
const btnGuardar = $<HTMLButtonElement>('guardar-perfil');
const btnCancelar = $<HTMLButtonElement>('cancelar-perfil');
const btnGenerar = $<HTMLButtonElement>('generar');
const btnExportar = $<HTMLButtonElement>('exportar');
const estado = $<HTMLParagraphElement>('estado');
const salida = $<HTMLTextAreaElement>('salida');

let almacen: Almacen = leerAlmacen(localStorage);
/** Índice del perfil que se edita; igual a perfiles.length si es uno nuevo. */
let editando = 0;
let perfil: Perfil | null = null;
let gcode: string | null = null;

const fmtArea = (v: number) => milesimasCortas(aMilesimas(v));

function leerFormulario(): PerfilCrudo {
  const r: Record<string, string> = {};
  for (const k of Object.keys(campos) as Campo[]) r[k] = campos[k].value;
  return r;
}

function llenarFormulario(p: PerfilCrudo): void {
  for (const k of Object.keys(campos) as Campo[]) {
    const v = p[k];
    campos[k].value = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  }
  validarFormulario();
}

function validarFormulario(): void {
  const personalizada = campos.origen.value === 'personalizada';
  camposCama.hidden = personalizada;
  camposArea.hidden = !personalizada;
  const r = validarPerfil(leerFormulario());
  errores.replaceChildren(
    ...(r.ok ? [] : r.errores).map((e) => {
      const li = document.createElement('li');
      li.textContent = e;
      return li;
    }),
  );
  btnGuardar.disabled = !r.ok;
  if (r.ok) {
    const a = r.perfil.config.area;
    areaResumen.textContent = `Área de trabajo: X ${fmtArea(a.xMin)} a ${fmtArea(a.xMax)}, Y ${fmtArea(a.yMin)} a ${fmtArea(a.yMax)} mm.`;
  } else areaResumen.textContent = '';
}

function llenarSelectorPerfiles(): void {
  perfilSelect.replaceChildren(
    ...almacen.perfiles.map((p, i) => new Option(typeof p.nombre === 'string' && p.nombre ? p.nombre : `Perfil ${i + 1}`, String(i))),
  );
  if (editando >= almacen.perfiles.length) perfilSelect.append(new Option('(nuevo perfil)', String(editando)));
  perfilSelect.value = String(editando);
}

function mostrarPantallaMaquina(primeraVez: boolean): void {
  invalidarGcode();
  pantalla.hidden = false;
  principal.hidden = true;
  intro.textContent = primeraVez
    ? 'Antes de empezar, configura tu máquina. Copia los valores de la configuración de tu máquina: no hay valores por defecto.'
    : 'Edita el perfil de la máquina. Los cambios se aplican al guardar.';
  filaPerfiles.hidden = primeraVez;
  btnCancelar.hidden = primeraVez || perfil === null;
  editando = primeraVez ? 0 : almacen.activo;
  llenarSelectorPerfiles();
  llenarFormulario(almacen.perfiles[editando] ?? {});
  campos.nombre.focus();
}

function mostrarApp(): void {
  perfil = perfilActivo(almacen);
  if (!perfil) return mostrarPantallaMaquina(almacen.perfiles.length === 0);
  pantalla.hidden = true;
  principal.hidden = false;
  const a = perfil.config.area;
  $<HTMLElement>('perfil-activo').textContent = perfil.nombre;
  $<HTMLElement>('perfil-detalle').textContent =
    `($30 = ${fmtArea(perfil.config.sMax)}; área X ${fmtArea(a.xMin)} a ${fmtArea(a.xMax)}, Y ${fmtArea(a.yMin)} a ${fmtArea(a.yMax)} mm)`;
  invalidarGcode();
}

function invalidarGcode(): void {
  gcode = null;
  salida.value = '';
  btnExportar.disabled = true;
  estado.textContent = '';
  delete estado.dataset.ruta;
}

for (const el of Object.values(campos)) {
  el.addEventListener('input', validarFormulario);
  el.addEventListener('change', validarFormulario);
}

$<HTMLButtonElement>('preset-grbl').addEventListener('click', () => {
  for (const [k, v] of Object.entries(PRESET_GRBL11)) campos[k as Campo].value = String(v);
  validarFormulario();
});

$<HTMLButtonElement>('leer-dolar').addEventListener('click', () => {
  const valores = leerSalidaDolarDolar($<HTMLTextAreaElement>('pegar-dolar').value);
  for (const [k, v] of Object.entries(valores)) campos[k as Campo].value = v;
  validarFormulario();
});

perfilSelect.addEventListener('change', () => {
  editando = Number(perfilSelect.value);
  llenarFormulario(almacen.perfiles[editando] ?? {});
});

$<HTMLButtonElement>('nuevo-perfil').addEventListener('click', () => {
  editando = almacen.perfiles.length;
  llenarSelectorPerfiles();
  llenarFormulario({});
});

btnGuardar.addEventListener('click', () => {
  const crudo = leerFormulario();
  if (!validarPerfil(crudo).ok) return validarFormulario();
  const perfiles = [...almacen.perfiles];
  perfiles[editando] = crudo;
  almacen = { perfiles, activo: editando };
  escribirAlmacen(localStorage, almacen);
  mostrarApp();
});

btnCancelar.addEventListener('click', () => mostrarApp());
$<HTMLButtonElement>('maquina').addEventListener('click', () => mostrarPantallaMaquina(false));

btnGenerar.addEventListener('click', () => {
  invalidarGcode();
  if (!perfil) return mostrarApp();
  try {
    const trabajo = generarCuadricula(tamanoArea(perfil.config.area));
    gcode = generarGcode(trabajo, perfil.config);
    salida.value = gcode;
    btnExportar.disabled = false;
    estado.textContent = `Cuadrícula generada: ${gcode.split('\n').length - 1} líneas.`;
  } catch (e) {
    estado.textContent = e instanceof ErrorGcode ? e.message : 'Error inesperado al generar el G-code.';
  }
});

btnExportar.addEventListener('click', async () => {
  // Se vuelve a validar el perfil guardado justo antes de exportar.
  almacen = leerAlmacen(localStorage);
  if (!perfilActivo(almacen) || gcode === null) {
    invalidarGcode();
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

mostrarApp();
