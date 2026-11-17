import './estilo.css';
import {
  CUADRICULA_PREDETERMINADA,
  ErrorGcode,
  MENSAJES,
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
  <header class="topbar">
    <h1 class="marca">Chopi<span>Laser</span> <small>(nombre provisional)</small></h1>
  </header>
  <div class="contenido">

  <section id="pantalla-maquina" data-testid="pantalla-maquina" class="panel cut asistente" aria-labelledby="t-maquina" hidden>
    <h2 id="t-maquina">Configura tu máquina</h2>
    <p class="lead" id="intro-maquina">ChopiLaser necesita saber cómo es tu láser antes de exportar. Solo se pide una vez; después lo cambias en «Máquina».</p>
    <div id="fila-perfiles" class="fila" hidden>
      <label class="campo-linea">Perfil <select id="perfil-select" data-testid="perfil-select"></select></label>
      <button id="nuevo-perfil" data-testid="nuevo-perfil" class="btn btn-ghost" type="button">Nuevo perfil</button>
    </div>
    <div class="herramientas">
    <div class="bloque">
      <button id="preset-grbl" data-testid="preset-grbl" class="btn btn-ghost" type="button">Usar valores de fábrica de GRBL 1.1</button>
      <small class="ayuda">Llena $30=1000 y $32=0. El nombre, el área y el origen los pones tú.</small>
    </div>
    <details id="caja-dolar" class="bloque">
      <summary class="btn btn-ghost">Pegar salida de $$</summary>
      <p class="nota">Escribe $$ en la consola de tu máquina, copia todo lo que responda y pégalo aquí.</p>
      <textarea id="pegar-dolar" data-testid="pegar-dolar" rows="6" spellcheck="false" aria-label="Pegar salida de $$"></textarea>
      <button id="leer-dolar" data-testid="leer-dolar" class="btn btn-cyan" type="button">Leer valores</button>
      <p id="dolar-estado" data-testid="dolar-estado" role="status"></p>
    </details>
    </div>
    <form id="form-maquina" class="form-grid" novalidate>
      <div class="campo campo-nombre">
        <label for="perfil-nombre">Nombre de la máquina</label>
        <input id="perfil-nombre" data-testid="perfil-nombre" placeholder="Ej. Láser del taller" autocomplete="off" aria-describedby="ayuda-nombre error-nombre" />
        <small class="ayuda" id="ayuda-nombre">Para reconocerla si tienes varias.</small>
        <small class="error-campo" id="error-nombre" data-testid="error-nombre"></small>
      </div>
      <div class="campo">
        <label for="s-max">Potencia máxima ($30)</label>
        <input id="s-max" data-testid="s-max" inputmode="decimal" autocomplete="off" aria-describedby="ayuda-smax error-sMax" />
        <small class="ayuda" id="ayuda-smax">El valor de S que equivale al 100 %. Aparece en la respuesta de $$ como $30=.</small>
        <small class="error-campo" id="error-sMax" data-testid="error-sMax"></small>
      </div>
      <div class="campo">
        <label for="modo-32">Modo láser ($32)</label>
        <select id="modo-32" data-testid="modo-32" aria-describedby="ayuda-32">
          <option value="">Elige una opción</option>
          <option value="1">Activado ($32=1)</option>
          <option value="0">Desactivado ($32=0)</option>
        </select>
        <small class="ayuda" id="ayuda-32">ChopiLaser apaga el láser en cada movimiento rápido, esté como esté este valor.</small>
      </div>
      <fieldset>
        <legend>Área de trabajo (mm)</legend>
        <div id="campos-cama" class="rejilla">
          <div class="campo">
            <label for="cama-ancho">Ancho (X)</label>
            <input id="cama-ancho" data-testid="cama-ancho" inputmode="decimal" autocomplete="off" aria-describedby="ayuda-area error-camaAncho" />
            <small class="error-campo" id="error-camaAncho" data-testid="error-camaAncho"></small>
          </div>
          <div class="campo">
            <label for="cama-alto">Fondo (Y)</label>
            <input id="cama-alto" data-testid="cama-alto" inputmode="decimal" autocomplete="off" aria-describedby="ayuda-area error-camaAlto" />
            <small class="error-campo" id="error-camaAlto" data-testid="error-camaAlto"></small>
          </div>
          <small class="ayuda ancho-completo" id="ayuda-area">Lo que de verdad recorre el cabezal sobre tu mesa. En $$ viene como $130 y $131.</small>
        </div>
        <div id="campos-area" class="rejilla" hidden>
          <small class="ayuda ancho-completo" id="ayuda-avanzado" data-testid="ayuda-avanzado">Para máquinas que quedan en coordenadas negativas después del homing.</small>
          ${(['xMin', 'yMin', 'xMax', 'yMax'] as const)
            .map((c) => {
              const id = c.replace(/([A-Z])/, '-$1').toLowerCase();
              return `<div class="campo">
            <label for="${id}">${c.toLowerCase()}</label>
            <input id="${id}" data-testid="${id}" inputmode="decimal" autocomplete="off" aria-describedby="error-${c}" />
            <small class="error-campo" id="error-${c}" data-testid="error-${c}"></small>
          </div>`;
            })
            .join('')}
        </div>
        <div class="campo">
          <label for="origen">¿Dónde queda el 0,0 después del homing?</label>
          <select id="origen" data-testid="origen" aria-describedby="ayuda-origen error-origen">
            <option value="">Elige una opción</option>
            ${ORIGENES.map((o) => `<option value="${o.valor}">${o.texto}</option>`).join('')}
          </select>
          <small class="ayuda" id="ayuda-origen">Es la esquina a la que va la máquina cuando busca sus topes.</small>
          <small class="error-campo" id="error-origen" data-testid="error-origen"></small>
        </div>
        <p id="area-resumen" data-testid="area-resumen" class="nota"></p>
      </fieldset>
    </form>
    <div class="acciones">
      <p id="errores" data-testid="errores" class="errores" role="alert"></p>
      <button id="cancelar-perfil" data-testid="cancelar-perfil" class="btn btn-ghost" type="button" hidden>Cancelar</button>
      <button id="guardar-perfil" data-testid="guardar-perfil" class="btn btn-orange" type="button" aria-describedby="errores">Guardar y empezar</button>
    </div>
  </section>

  <main id="app-principal" data-testid="app-principal" hidden>
    <div class="fila barra-perfil panel cut">
      <p>Perfil: <strong id="perfil-activo" data-testid="perfil-activo"></strong> <span id="perfil-detalle" data-testid="perfil-detalle" class="nota"></span></p>
      <button id="maquina" data-testid="maquina" class="btn btn-ghost" type="button">Máquina</button>
    </div>
    <section class="panel cut tarjeta" aria-labelledby="t-cuadricula">
      <h2 id="t-cuadricula">Cuadrícula de prueba</h2>
      <p class="nota">Cuadros de potencia (${CUADRICULA_PREDETERMINADA.potencias.join(', ')} %) por velocidad
        (${CUADRICULA_PREDETERMINADA.velocidades.join(', ')} mm/min), en M3 y en M4. Ocupa ${t.ancho} x ${t.alto} mm
        desde la esquina inferior izquierda del área de trabajo.</p>
      <div class="fila">
        <button id="generar" data-testid="generar" class="btn btn-cyan" type="button">Generar cuadrícula de prueba</button>
        <button id="exportar" data-testid="exportar" class="btn btn-orange" type="button" disabled>Exportar .gcode</button>
      </div>
      <p id="estado" data-testid="estado" role="status"></p>
      <textarea id="salida" data-testid="salida" readonly rows="16" spellcheck="false" aria-label="G-code generado"></textarea>
    </section>
  </main>
  </div>
  <footer class="pie"><p>Software libre bajo licencia GPLv3 o posterior.</p></footer>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pantalla = $<HTMLElement>('pantalla-maquina');
const principal = $<HTMLElement>('app-principal');
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
const errores = $<HTMLParagraphElement>('errores');
const dolarEstado = $<HTMLParagraphElement>('dolar-estado');
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
/** Campos que ya perdieron el foco: solo ellos muestran su error. */
const tocados = new Set<Campo>();
/** Se intentó guardar: se muestran todos los errores. */
let intentoGuardar = false;
/** Orden de los campos en pantalla, para llevar el foco al primero con error. */
const ORDEN: Exclude<Campo, 'laserMode32'>[] = ['nombre', 'sMax', 'camaAncho', 'camaAlto', 'xMin', 'yMin', 'xMax', 'yMax', 'origen'];

function reiniciarErrores(): void {
  tocados.clear();
  intentoGuardar = false;
}

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

/** Valida y muestra los errores solo de los campos tocados, o de todos tras intentar guardar. */
function validarFormulario(): ReturnType<typeof validarPerfil> {
  const personalizada = campos.origen.value === 'personalizada';
  camposCama.hidden = personalizada;
  camposArea.hidden = !personalizada;
  const r = validarPerfil(leerFormulario());
  const porCampo = r.ok ? {} : r.porCampo;
  for (const k of Object.keys(campos) as Campo[]) {
    const visible = intentoGuardar || tocados.has(k);
    const msg = k === 'laserMode32' || !visible ? undefined : porCampo[k];
    const el = document.getElementById(`error-${k}`);
    if (el) el.textContent = msg ?? '';
    if (msg) campos[k].setAttribute('aria-invalid', 'true');
    else campos[k].removeAttribute('aria-invalid');
  }
  errores.textContent = !r.ok && intentoGuardar ? 'Completa los campos marcados para continuar.' : '';
  if (r.ok) {
    const a = r.perfil.config.area;
    areaResumen.textContent = `Área de trabajo: X ${fmtArea(a.xMin)} a ${fmtArea(a.xMax)}, Y ${fmtArea(a.yMin)} a ${fmtArea(a.yMax)} mm.`;
  } else areaResumen.textContent = '';
  return r;
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
  filaPerfiles.hidden = primeraVez;
  btnCancelar.hidden = primeraVez || perfil === null;
  editando = primeraVez ? 0 : almacen.activo;
  reiniciarErrores();
  llenarSelectorPerfiles();
  llenarFormulario(almacen.perfiles[editando] ?? {});
  dolarEstado.textContent = '';
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

for (const [k, el] of Object.entries(campos) as [Campo, HTMLInputElement | HTMLSelectElement][]) {
  el.addEventListener('input', () => validarFormulario());
  el.addEventListener('change', () => validarFormulario());
  el.addEventListener('blur', () => {
    // Si se va el foco de la ventana (otra pestaña o app), no cuenta como salir del campo.
    if (!document.hasFocus()) return;
    tocados.add(k);
    validarFormulario();
  });
}

$<HTMLButtonElement>('preset-grbl').addEventListener('click', () => {
  for (const [k, v] of Object.entries(PRESET_GRBL11)) campos[k as Campo].value = String(v);
  validarFormulario();
});

$<HTMLButtonElement>('leer-dolar').addEventListener('click', () => {
  const valores = leerSalidaDolarDolar($<HTMLTextAreaElement>('pegar-dolar').value);
  const n = Object.keys(valores).length;
  for (const [k, v] of Object.entries(valores)) campos[k as Campo].value = v;
  dolarEstado.textContent =
    n > 0
      ? `Listo: se llenaron ${n} valores. Revísalos antes de guardar.`
      : 'No encontré valores de GRBL en el texto. Copia la respuesta completa de $$.';
  dolarEstado.className = n > 0 ? 'ok' : 'errores';
  validarFormulario();
});

perfilSelect.addEventListener('change', () => {
  editando = Number(perfilSelect.value);
  reiniciarErrores();
  llenarFormulario(almacen.perfiles[editando] ?? {});
});

$<HTMLButtonElement>('nuevo-perfil').addEventListener('click', () => {
  editando = almacen.perfiles.length;
  reiniciarErrores();
  llenarSelectorPerfiles();
  llenarFormulario({});
});

// Al pulsar «Guardar y empezar» con el ratón, el campo activo no pierde el foco antes del clic:
// así su error no aparece entre mousedown y mouseup, desplazando el botón y perdiendo el clic.
btnGuardar.addEventListener('mousedown', (e) => e.preventDefault());

btnGuardar.addEventListener('click', () => {
  const crudo = leerFormulario();
  if (!validarPerfil(crudo).ok) {
    // El guardado sigue bloqueado: se muestran todos los errores y el foco va al primero.
    intentoGuardar = true;
    const r = validarFormulario();
    if (!r.ok) {
      const primero = ORDEN.find((k) => r.porCampo[k] && campos[k].offsetParent !== null);
      if (primero) campos[primero].focus();
    }
    return;
  }
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
    estado.textContent = MENSAJES.exportarSinPerfil;
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
