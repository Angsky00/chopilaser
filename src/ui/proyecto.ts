// Interfaz del proyecto (fase 1): material, lienzo, importar SVG/DXF, propiedades,
// capas por color y exportar con el generador seguro.
import { ErrorGcode, generarGcode, tamanoArea, type Perfil } from '../gcode';
import { exportarGcode, descargarBlob } from '../exportar';
import { aplicarValores, borrar, valoresSeleccion } from '../diseno/edicion';
import {
  figurasDesdeImportacion,
  sincronizarCapas,
  trabajoDesdeProyecto,
  validarCapa,
  type CampoCapa,
  type CapaProyecto,
  type Figura,
  type ModoCapa,
  type Proyecto,
} from '../diseno/proyecto';
import { importarSvg } from '../importar/svg';
import { importarDxf } from '../importar/dxf';
import type { ResultadoImportacion } from '../importar/tipos';
import {
  errorAjuste,
  errorNombreMaterial,
  escribirMateriales,
  exportarMateriales,
  leerArchivoMateriales,
  leerMateriales,
  materialesDanados,
  materialNuevo,
  MAX_BYTES_MATERIALES,
  TEXTOS_IMPORTAR_MATERIALES,
  type AjusteGrabado,
  type Material,
} from '../materiales';
import { Lienzo } from './lienzo';

/** Textos provisionales de la interfaz del proyecto (pendientes de Marketing). */
export const TEXTOS_PROYECTO = {
  titulo: 'Proyecto',
  introInicio: 'Elige el material para empezar. Sus ajustes llenan las capas; si todavía están vacíos, llénalos con lo que te dio la cuadrícula de prueba.',
  material: 'Material',
  elegirMaterial: 'Elige un material',
  sinMateriales: 'Todavía no hay materiales. Crea uno con su nombre.',
  nombreNuevo: 'Nombre del material nuevo',
  crearMaterial: 'Crear material',
  materialCreado: (n: string) => `Material «${n}» creado.`,
  empezar: 'Empezar proyecto',
  faltaMaterial: 'Elige o crea un material para empezar.',
  importar: 'Importar SVG o DXF',
  borrar: 'Borrar',
  nuevoProyecto: 'Nuevo proyecto',
  confirmarNuevo: 'Se borrará el diseño actual. ¿Empezar un proyecto nuevo?',
  importado: (n: number, archivo: string) => (n === 1 ? `Se importó 1 figura de «${archivo}».` : `Se importaron ${n} figuras de «${archivo}».`),
  sinFiguras: (archivo: string) => `No encontré figuras en «${archivo}».`,
  omitidos: (lista: string) => `No se importaron: ${lista}.`,
  formatoNoSoportado: 'Solo se pueden importar archivos .svg o .dxf.',
  errorLeer: (archivo: string, motivo: string) => `No se pudo importar «${archivo}»: ${motivo}`,
  propiedades: 'Posición y tamaño (mm)',
  sinSeleccion: 'Toca una figura para seleccionarla, o arrastra un recuadro para elegir varias.',
  x: 'X',
  y: 'Y',
  ancho: 'Ancho',
  alto: 'Alto',
  angulo: 'Ángulo (°)',
  proporcion: 'Mantener proporción',
  ayudaLienzo: 'Arrastra para mover. Tiradores: escalar (con Mayús, proporcional) y girar (con Mayús, de 15° en 15°). Flechas: mover 1 mm (con Mayús, 10 mm). Ctrl+A: seleccionar todo. Supr: borrar.',
  ayudaVista: 'Zoom: rueda del ratón, pellizco o + y −. Mover la vista: arrastra con la barra espaciadora pulsada, con el botón central o con dos dedos. 0 o «Ajustar»: ver toda el área.',
  ajustar: 'Ajustar',
  acercar: 'Acercar',
  alejar: 'Alejar',
  capas: 'Capas',
  sinCapas: 'Las capas aparecen al importar un diseño: una por cada color de trazo.',
  capa: (n: number) => `Capa ${n}`,
  modo: 'Modo',
  corte: 'Corte',
  grabado: 'Grabado',
  potencia: 'Potencia (%)',
  velocidad: 'Velocidad (mm/min)',
  pasadas: 'Pasadas',
  intervalo: 'Intervalo (mm)',
  ver: 'Ver',
  salida: 'Salida',
  exportar: 'Exportar .gcode',
  exportado: 'Archivo guardado.',
  descargado: 'Archivo descargado.',
  cancelado: 'Exportación cancelada.',
  errorGuardar: 'No se pudo guardar el archivo.',
  sinPerfil: 'Antes de exportar, configura tu máquina.',
  errorGenerar: 'Error inesperado al generar el G-code.',
  vistaLienzo: 'Vista del lienzo',
  ajustesMaterial: 'Ajustes del material',
  ayudaAjustes: 'Llena estos valores con los que mejor resultado te dieron en la cuadrícula de prueba con este material. Se usan al crear capas nuevas.',
  guardarAjustes: 'Guardar ajustes',
  ajustesGuardados: 'Ajustes guardados.',
  exportarMateriales: 'Exportar materiales',
  importarMateriales: 'Importar materiales',
  materialesDanados: 'Los materiales guardados en este navegador no se pudieron leer. Importa tus materiales desde un archivo o créalos de nuevo. Al guardar se conserva una copia de los datos dañados.',
} as const;

const T = TEXTOS_PROYECTO;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...hijos: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  e.append(...hijos);
  return e;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export interface ApiProyecto {
  /** El perfil activo cambió (o se volvió a leer). */
  fijarPerfil(p: Perfil | null): void;
}

export function montarProyecto(raiz: HTMLElement, perfilGuardado: () => Perfil | null): ApiProyecto {
  let perfil: Perfil | null = null;
  let materiales: Material[] = leerMateriales(localStorage);
  let proyecto: Proyecto | null = null;
  let sel = new Set<string>();
  let intentoExportar = false;

  raiz.innerHTML = '';
  raiz.classList.add('proyecto');
  const titulo = h('h2', { id: 't-proyecto', text: T.titulo });
  const aviso = h('p', { class: 'aviso panel cut', 'data-testid': 'aviso-materiales', role: 'alert', text: T.materialesDanados });
  aviso.hidden = !materialesDanados(localStorage);
  const inicio = h('div', { class: 'inicio-proyecto', 'data-testid': 'inicio-proyecto' });
  const editor = h('div', { class: 'editor-proyecto', 'data-testid': 'editor-proyecto' });
  editor.hidden = true;
  raiz.append(titulo, aviso, inicio, editor);

  // --- Inicio: elegir material -------------------------------------------------
  const selMaterial = h('select', { id: 'material-select', 'data-testid': 'material-select' });
  const nombreNuevo = h('input', { id: 'material-nuevo', 'data-testid': 'material-nuevo', placeholder: T.nombreNuevo, autocomplete: 'off', 'aria-label': T.nombreNuevo });
  const btnCrear = h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'crear-material', text: T.crearMaterial });
  const inicioEstado = h('p', { 'data-testid': 'inicio-estado', role: 'status' });
  const btnEmpezar = h('button', { type: 'button', class: 'btn btn-orange', 'data-testid': 'empezar-proyecto', text: T.empezar });
  inicio.append(
    h('p', { class: 'lead', text: T.introInicio }),
    h('div', { class: 'fila' }, h('label', { class: 'campo-linea', for: 'material-select', text: T.material }), selMaterial),
    h('div', { class: 'fila' }, nombreNuevo, btnCrear),
    inicioEstado,
    h('div', { class: 'acciones' }, btnEmpezar),
  );

  function llenarMateriales(): void {
    const actual = selMaterial.value;
    selMaterial.replaceChildren(new Option(materiales.length ? T.elegirMaterial : T.sinMateriales, ''), ...materiales.map((m) => new Option(m.nombre, m.nombre)));
    if (materiales.some((m) => m.nombre === actual)) selMaterial.value = actual;
  }

  btnCrear.addEventListener('click', () => {
    const err = errorNombreMaterial(nombreNuevo.value, materiales.map((m) => m.nombre));
    if (err) {
      inicioEstado.textContent = err;
      inicioEstado.className = 'errores';
      nombreNuevo.focus();
      return;
    }
    const m = materialNuevo(nombreNuevo.value);
    materiales = [...leerMateriales(localStorage), m];
    escribirMateriales(localStorage, materiales);
    aviso.hidden = true;
    nombreNuevo.value = '';
    llenarMateriales();
    selMaterial.value = m.nombre;
    inicioEstado.textContent = T.materialCreado(m.nombre);
    inicioEstado.className = 'ok';
  });

  btnEmpezar.addEventListener('click', () => {
    const m = materiales.find((x) => x.nombre === selMaterial.value);
    if (!m) {
      inicioEstado.textContent = T.faltaMaterial;
      inicioEstado.className = 'errores';
      selMaterial.focus();
      return;
    }
    proyecto = { material: m.nombre, figuras: [], capas: [] };
    sel = new Set();
    intentoExportar = false;
    mostrar();
  });

  // --- Editor -----------------------------------------------------------------
  const nombreMaterial = h('strong', { 'data-testid': 'proyecto-material' });
  const archivo = h('input', { type: 'file', accept: '.svg,.dxf,image/svg+xml', 'data-testid': 'importar-diseno', hidden: '' });
  const btnImportar = h('button', { type: 'button', class: 'btn btn-cyan', 'data-testid': 'importar-diseno-btn', text: T.importar });
  const btnBorrar = h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'borrar', text: T.borrar });
  const btnNuevo = h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'nuevo-proyecto', text: T.nuevoProyecto });
  const estadoProyecto = h('p', { 'data-testid': 'proyecto-estado', role: 'status' });
  const contLienzo = h('div', { class: 'lienzo-contenedor', 'data-testid': 'lienzo-contenedor' });
  const lateral = h('div', { class: 'lateral' });
  editor.append(
    h('div', { class: 'fila barra-proyecto' }, h('p', {}, `${T.material}: `, nombreMaterial), btnImportar, archivo, btnBorrar, btnNuevo),
    estadoProyecto,
    h(
      'div',
      { class: 'mesa' },
      h(
        'div',
        { class: 'columna-lienzo' },
        contLienzo,
        h(
          'div',
          { class: 'vista-lienzo', role: 'group', 'aria-label': T.vistaLienzo },
          h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'zoom-menos', 'aria-label': T.alejar, title: T.alejar, text: '−' }),
          h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'zoom-mas', 'aria-label': T.acercar, title: T.acercar, text: '+' }),
          h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'ajustar-vista', text: T.ajustar }),
        ),
        h('p', { class: 'nota', text: T.ayudaLienzo }),
        h('p', { class: 'nota', text: T.ayudaVista }),
      ),
      lateral,
    ),
  );

  editor.querySelector('[data-testid="zoom-menos"]')!.addEventListener('click', () => lienzo.zoom(0.8));
  editor.querySelector('[data-testid="zoom-mas"]')!.addEventListener('click', () => lienzo.zoom(1.25));
  editor.querySelector('[data-testid="ajustar-vista"]')!.addEventListener('click', () => lienzo.ajustar());
  const lienzo = new Lienzo(contLienzo, {
    cambio(figuras, final) {
      if (!proyecto) return;
      proyecto.figuras = figuras;
      if (final) {
        proyecto.capas = sincronizarCapas(figuras, proyecto.capas, capaNueva);
        pintarCapas();
      }
      pintarPropiedades();
      pintarExportar();
    },
    seleccion(ids) {
      sel = ids;
      pintarPropiedades();
    },
  });

  // Propiedades
  const campos = {
    x: h('input', { 'data-testid': 'prop-x', inputmode: 'decimal', autocomplete: 'off' }),
    y: h('input', { 'data-testid': 'prop-y', inputmode: 'decimal', autocomplete: 'off' }),
    ancho: h('input', { 'data-testid': 'prop-ancho', inputmode: 'decimal', autocomplete: 'off' }),
    alto: h('input', { 'data-testid': 'prop-alto', inputmode: 'decimal', autocomplete: 'off' }),
    angulo: h('input', { 'data-testid': 'prop-angulo', inputmode: 'decimal', autocomplete: 'off' }),
  };
  const proporcion = h('input', { type: 'checkbox', 'data-testid': 'prop-proporcion', checked: '' });
  const sinSel = h('p', { class: 'nota', 'data-testid': 'sin-seleccion', text: T.sinSeleccion });
  const rejillaProps = h('div', { class: 'rejilla-props' });
  for (const [k, input] of Object.entries(campos)) {
    const id = `prop-${k}`;
    input.id = id;
    rejillaProps.append(h('div', { class: 'campo' }, h('label', { for: id, text: T[k as keyof typeof campos] }), input));
  }
  const panelProps = h(
    'section',
    { class: 'panel cut bloque-lateral', 'aria-labelledby': 't-props' },
    h('h3', { id: 't-props', text: T.propiedades }),
    sinSel,
    rejillaProps,
    h('label', { class: 'check' }, proporcion, T.proporcion),
  );

  // Capas
  const listaCapas = h('div', { class: 'lista-capas', 'data-testid': 'capas' });
  const panelCapas = h('section', { class: 'panel cut bloque-lateral', 'aria-labelledby': 't-capas' }, h('h3', { id: 't-capas', text: T.capas }), listaCapas);

  // Exportar
  const btnExportar = h('button', { type: 'button', class: 'btn btn-orange', 'data-testid': 'exportar-proyecto', text: T.exportar });
  const estadoExportar = h('p', { 'data-testid': 'exportar-estado', role: 'status' });
  const panelExportar = h('section', { class: 'panel cut bloque-lateral' }, btnExportar, estadoExportar);

  // Ajustes del material
  const ajustes = {
    corte: { potencia: h('input'), velocidad: h('input'), pasadas: h('input') },
    grabado: { potencia: h('input'), velocidad: h('input'), pasadas: h('input'), intervalo: h('input') },
  };
  const panelMaterial = h('details', { class: 'panel cut bloque-lateral', 'data-testid': 'panel-material' });
  const errAjustes = h('p', { 'data-testid': 'ajustes-estado', role: 'status' });
  const btnGuardarAjustes = h('button', { type: 'button', class: 'btn btn-cyan', 'data-testid': 'guardar-ajustes', text: T.guardarAjustes });
  const btnExpMat = h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'exportar-materiales', text: T.exportarMateriales });
  const btnImpMat = h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'importar-materiales', text: T.importarMateriales });
  const archivoMat = h('input', { type: 'file', accept: '.json,application/json', 'data-testid': 'importar-materiales-archivo', hidden: '' });
  const estadoMat = h('p', { 'data-testid': 'materiales-estado', role: 'status' });
  panelMaterial.append(h('summary', { class: 'btn btn-ghost', text: T.ajustesMaterial }), h('p', { class: 'nota', text: T.ayudaAjustes }));
  for (const modo of ['corte', 'grabado'] as const) {
    const fs = h('fieldset', {}, h('legend', { text: modo === 'corte' ? T.corte : T.grabado }));
    const rej = h('div', { class: 'rejilla-props' });
    for (const [k, input] of Object.entries(ajustes[modo])) {
      input.id = `ajuste-${modo}-${k}`;
      input.setAttribute('data-testid', input.id);
      input.setAttribute('inputmode', 'decimal');
      input.setAttribute('autocomplete', 'off');
      rej.append(h('div', { class: 'campo' }, h('label', { for: input.id, text: T[k as 'potencia'] }), input));
    }
    fs.append(rej);
    panelMaterial.append(fs);
  }
  panelMaterial.append(btnGuardarAjustes, errAjustes, h('div', { class: 'fila' }, btnExpMat, btnImpMat, archivoMat), estadoMat);
  lateral.append(panelProps, panelCapas, panelExportar, panelMaterial);

  function materialActual(): Material | undefined {
    return proyecto ? materiales.find((m) => m.nombre === proyecto!.material) : undefined;
  }

  function valoresDeMaterial(modo: ModoCapa): Partial<AjusteGrabado> {
    const m = materialActual();
    if (!m) return {};
    const a = modo === 'corte' ? m.corte : m.grabado;
    return errorAjuste(modo, a) === null ? a : {};
  }

  function capaNueva(color: string): CapaProyecto {
    const v = valoresDeMaterial('corte');
    return { color, modo: 'corte', potencia: v.potencia ?? '', velocidad: v.velocidad ?? '', pasadas: v.pasadas ?? '', intervalo: '', visible: true, salida: true };
  }

  function areaActual(): { ancho: number; alto: number } {
    return perfil ? tamanoArea(perfil.config.area) : { ancho: 100, alto: 100 };
  }

  function pintarLienzo(): void {
    if (!proyecto) return;
    lienzo.actualizar(proyecto.figuras, proyecto.capas, sel);
    sel = lienzo.seleccion();
  }

  function pintarPropiedades(): void {
    if (!proyecto) return;
    const v = valoresSeleccion(proyecto.figuras, sel);
    sinSel.hidden = !!v;
    rejillaProps.hidden = !v;
    btnBorrar.disabled = !v;
    if (!v) return;
    const vals: Record<keyof typeof campos, string> = { x: fmt(v.x), y: fmt(v.y), ancho: fmt(v.ancho), alto: fmt(v.alto), angulo: v.varias ? '' : fmt(v.angulo) };
    for (const [k, input] of Object.entries(campos) as [keyof typeof campos, HTMLInputElement][]) {
      if (document.activeElement !== input) input.value = vals[k];
    }
    campos.angulo.disabled = v.varias;
  }

  function aplicarCampo(k: keyof typeof campos): void {
    if (!proyecto) return;
    const v = valoresSeleccion(proyecto.figuras, sel);
    if (!v) return;
    const n = /^-?\d+(\.\d+)?$/.test(campos[k].value.trim()) ? Number(campos[k].value.trim()) : NaN;
    if (!Number.isFinite(n) || ((k === 'ancho' || k === 'alto') && n <= 0)) {
      pintarPropiedades();
      return;
    }
    const nuevo = { x: v.x, y: v.y, ancho: v.ancho, alto: v.alto, angulo: v.angulo, [k]: n };
    if (proporcion.checked && (k === 'ancho' || k === 'alto')) {
      const base = k === 'ancho' ? v.ancho : v.alto;
      const kf = base > 0 ? n / base : 1;
      nuevo.ancho = v.ancho * kf;
      nuevo.alto = v.alto * kf;
    }
    proyecto.figuras = aplicarValores(proyecto.figuras, sel, nuevo);
    // Tras cambiar tamaño o ángulo, X/Y se mantienen en la esquina pedida.
    if (k !== 'x' && k !== 'y') proyecto.figuras = aplicarValores(proyecto.figuras, sel, { ...valoresSeleccion(proyecto.figuras, sel)!, x: v.x, y: v.y });
    pintarLienzo();
    pintarPropiedades();
    pintarExportar();
  }
  for (const k of Object.keys(campos) as (keyof typeof campos)[]) {
    campos[k].addEventListener('change', () => aplicarCampo(k));
    campos[k].addEventListener('keydown', (e) => {
      if (e.key === 'Enter') aplicarCampo(k);
    });
  }

  function erroresCapa(c: CapaProyecto): Partial<Record<CampoCapa, string>> {
    const v = validarCapa(c);
    return v.ok ? {} : v.porCampo;
  }

  function pintarCapas(): void {
    if (!proyecto) return;
    listaCapas.replaceChildren();
    if (!proyecto.capas.length) {
      listaCapas.append(h('p', { class: 'nota', text: T.sinCapas }));
      return;
    }
    proyecto.capas.forEach((c, i) => {
      const fila = h('div', { class: 'capa', 'data-testid': `capa-${i + 1}`, 'data-color': c.color });
      const muestra = h('span', { class: 'muestra', style: `background:${c.color}`, 'aria-hidden': 'true' });
      const modo = h('select', { 'data-testid': `capa-${i + 1}-modo`, 'aria-label': `${T.capa(i + 1)}: ${T.modo}` });
      modo.append(new Option(T.corte, 'corte'), new Option(T.grabado, 'grabado'));
      modo.value = c.modo;
      const ver = h('input', { type: 'checkbox', 'data-testid': `capa-${i + 1}-ver` });
      ver.checked = c.visible;
      const salida = h('input', { type: 'checkbox', 'data-testid': `capa-${i + 1}-salida` });
      salida.checked = c.salida;
      const err = h('p', { class: 'error-campo', 'data-testid': `capa-${i + 1}-error` });
      const inputs: Partial<Record<CampoCapa, HTMLInputElement>> = {};
      const rej = h('div', { class: 'rejilla-props' });
      for (const k of ['potencia', 'velocidad', 'pasadas', 'intervalo'] as CampoCapa[]) {
        const input = h('input', { 'data-testid': `capa-${i + 1}-${k}`, id: `capa-${i + 1}-${k}`, inputmode: 'decimal', autocomplete: 'off' });
        input.value = c[k];
        inputs[k] = input;
        const campo = h('div', { class: 'campo' }, h('label', { for: input.id, text: T[k] }), input);
        if (k === 'intervalo') campo.hidden = c.modo !== 'grabado';
        rej.append(campo);
        input.addEventListener('input', () => {
          c[k] = input.value;
          mostrarError();
          pintarExportar();
        });
      }
      const mostrarError = () => {
        const e = erroresCapa(c);
        const visibles = (Object.keys(e) as CampoCapa[]).filter((k) => intentoExportar || c[k].trim() !== '');
        err.textContent = visibles.map((k) => e[k]).join(' ');
        for (const k of Object.keys(inputs) as CampoCapa[]) {
          if (visibles.includes(k)) inputs[k]!.setAttribute('aria-invalid', 'true');
          else inputs[k]!.removeAttribute('aria-invalid');
        }
      };
      modo.addEventListener('change', () => {
        c.modo = modo.value as ModoCapa;
        const v = valoresDeMaterial(c.modo);
        if (v.potencia !== undefined) Object.assign(c, { potencia: v.potencia, velocidad: v.velocidad, pasadas: v.pasadas, intervalo: v.intervalo ?? c.intervalo });
        pintarCapas();
        pintarExportar();
      });
      ver.addEventListener('change', () => {
        c.visible = ver.checked;
        pintarLienzo();
        pintarPropiedades();
        pintarExportar();
      });
      salida.addEventListener('change', () => {
        c.salida = salida.checked;
        pintarExportar();
      });
      fila.append(
        h('div', { class: 'capa-cabecera' }, muestra, h('strong', { text: T.capa(i + 1) }), h('span', { class: 'nota', text: c.color }), modo),
        rej,
        h('div', { class: 'fila' }, h('label', { class: 'check' }, ver, T.ver), h('label', { class: 'check' }, salida, T.salida)),
        err,
      );
      listaCapas.append(fila);
      mostrarError();
    });
  }

  function pintarExportar(): void {
    if (!proyecto) return;
    const r = trabajoDesdeProyecto(proyecto, areaActual());
    estadoExportar.dataset.ruta = '';
    if (r.ok) {
      estadoExportar.textContent = '';
      estadoExportar.className = '';
    } else {
      estadoExportar.textContent = r.error;
      estadoExportar.className = 'errores';
    }
  }

  btnExportar.addEventListener('click', async () => {
    if (!proyecto) return;
    intentoExportar = true;
    pintarCapas();
    // Como en la fase 0: siempre con el perfil guardado ahora mismo.
    const actual = perfilGuardado();
    if (!actual) {
      estadoExportar.textContent = T.sinPerfil;
      estadoExportar.className = 'errores';
      return;
    }
    perfil = actual;
    const r = trabajoDesdeProyecto(proyecto, tamanoArea(actual.config.area));
    if (!r.ok) {
      estadoExportar.textContent = r.error;
      estadoExportar.className = 'errores';
      return;
    }
    let texto: string;
    try {
      texto = generarGcode(r.trabajo, actual.config);
    } catch (e) {
      estadoExportar.textContent = e instanceof ErrorGcode ? e.message : T.errorGenerar;
      estadoExportar.className = 'errores';
      return;
    }
    try {
      const ruta = await exportarGcode(texto, 'proyecto.gcode');
      estadoExportar.textContent = ruta === 'selector' ? T.exportado : ruta === 'descarga' ? T.descargado : T.cancelado;
      estadoExportar.className = ruta === 'cancelada' ? '' : 'ok';
      estadoExportar.dataset.ruta = ruta;
    } catch {
      estadoExportar.textContent = T.errorGuardar;
      estadoExportar.className = 'errores';
    }
  });

  // Importar
  btnImportar.addEventListener('click', () => archivo.click());
  archivo.addEventListener('change', async () => {
    const f = archivo.files?.[0];
    archivo.value = '';
    if (f) await importarArchivo(f);
  });
  contLienzo.addEventListener('dragover', (e) => {
    e.preventDefault();
    contLienzo.classList.add('soltar');
  });
  contLienzo.addEventListener('dragleave', () => contLienzo.classList.remove('soltar'));
  contLienzo.addEventListener('drop', async (e) => {
    e.preventDefault();
    contLienzo.classList.remove('soltar');
    const f = e.dataTransfer?.files?.[0];
    if (f) await importarArchivo(f);
  });

  async function importarArchivo(f: File): Promise<void> {
    if (!proyecto) return;
    const nombre = f.name;
    const ext = nombre.toLowerCase().split('.').pop();
    let r: ResultadoImportacion;
    try {
      if (f.size > 20_000_000) throw new Error('el archivo pasa de 20 MB.');
      const texto = await f.text();
      if (ext === 'svg') r = importarSvg(texto);
      else if (ext === 'dxf') r = importarDxf(texto);
      else {
        estadoProyecto.textContent = T.formatoNoSoportado;
        estadoProyecto.className = 'errores';
        return;
      }
    } catch (e) {
      estadoProyecto.textContent = T.errorLeer(nombre, e instanceof Error ? e.message : String(e));
      estadoProyecto.className = 'errores';
      return;
    }
    const nuevas: Figura[] = figurasDesdeImportacion(r, areaActual());
    if (!nuevas.length) {
      estadoProyecto.textContent = T.sinFiguras(nombre);
      estadoProyecto.className = 'errores';
      return;
    }
    proyecto.figuras = [...proyecto.figuras, ...nuevas];
    proyecto.capas = sincronizarCapas(proyecto.figuras, proyecto.capas, capaNueva);
    sel = new Set(nuevas.map((x) => x.id));
    estadoProyecto.textContent = T.importado(nuevas.length, nombre) + (r.avisos.length ? ` ${T.omitidos(r.avisos.join(', '))}` : '');
    estadoProyecto.className = 'ok';
    pintarTodo();
  }

  btnBorrar.addEventListener('click', () => {
    if (!proyecto || !sel.size) return;
    proyecto.figuras = borrar(proyecto.figuras, sel);
    proyecto.capas = sincronizarCapas(proyecto.figuras, proyecto.capas, capaNueva);
    sel = new Set();
    pintarTodo();
  });

  btnNuevo.addEventListener('click', () => {
    if (proyecto && proyecto.figuras.length && !window.confirm(T.confirmarNuevo)) return;
    proyecto = null;
    sel = new Set();
    mostrar();
  });

  // Ajustes del material
  function pintarAjustes(): void {
    const m = materialActual();
    if (!m) return;
    for (const modo of ['corte', 'grabado'] as const)
      for (const [k, input] of Object.entries(ajustes[modo])) input.value = (m[modo] as unknown as Record<string, string>)[k] ?? '';
  }
  btnGuardarAjustes.addEventListener('click', () => {
    const m = materialActual();
    if (!m) return;
    const nuevo: Material = {
      nombre: m.nombre,
      corte: { potencia: ajustes.corte.potencia.value.trim(), velocidad: ajustes.corte.velocidad.value.trim(), pasadas: ajustes.corte.pasadas.value.trim() },
      grabado: {
        potencia: ajustes.grabado.potencia.value.trim(),
        velocidad: ajustes.grabado.velocidad.value.trim(),
        pasadas: ajustes.grabado.pasadas.value.trim(),
        intervalo: ajustes.grabado.intervalo.value.trim(),
      },
    };
    const e = errorAjuste('corte', nuevo.corte) ?? errorAjuste('grabado', nuevo.grabado);
    if (e) {
      errAjustes.textContent = e;
      errAjustes.className = 'errores';
      return;
    }
    materiales = leerMateriales(localStorage).map((x) => (x.nombre === m.nombre ? nuevo : x));
    if (!materiales.some((x) => x.nombre === m.nombre)) materiales.push(nuevo);
    escribirMateriales(localStorage, materiales);
    aviso.hidden = true;
    errAjustes.textContent = T.ajustesGuardados;
    errAjustes.className = 'ok';
  });
  btnExpMat.addEventListener('click', () => {
    descargarBlob(new Blob([exportarMateriales(leerMateriales(localStorage))], { type: 'application/json' }), 'chopilaser-materiales.json');
  });
  btnImpMat.addEventListener('click', () => archivoMat.click());
  archivoMat.addEventListener('change', async () => {
    const f = archivoMat.files?.[0];
    archivoMat.value = '';
    if (!f) return;
    if (f.size > MAX_BYTES_MATERIALES) {
      estadoMat.textContent = TEXTOS_IMPORTAR_MATERIALES.error(TEXTOS_IMPORTAR_MATERIALES.grande);
      estadoMat.className = 'errores';
      return;
    }
    const actuales = leerMateriales(localStorage);
    const r = leerArchivoMateriales(await f.text(), actuales.map((m) => m.nombre));
    if (!r.ok) {
      estadoMat.textContent = r.error;
      estadoMat.className = 'errores';
      return;
    }
    materiales = [...actuales, ...r.materiales];
    escribirMateriales(localStorage, materiales);
    aviso.hidden = true;
    llenarMateriales();
    estadoMat.textContent = TEXTOS_IMPORTAR_MATERIALES.ok(r.materiales.length);
    estadoMat.className = 'ok';
  });

  function pintarTodo(): void {
    pintarLienzo();
    pintarPropiedades();
    pintarCapas();
    pintarExportar();
  }

  function mostrar(): void {
    inicio.hidden = !!proyecto;
    editor.hidden = !proyecto;
    if (!proyecto) {
      materiales = leerMateriales(localStorage);
      llenarMateriales();
      inicioEstado.textContent = '';
      return;
    }
    nombreMaterial.textContent = proyecto.material;
    estadoProyecto.textContent = '';
    pintarAjustes();
    const a = areaActual();
    lienzo.fijarArea(a.ancho, a.alto);
    pintarTodo();
  }

  window.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== 'chopilaser.materiales.v1') return;
    materiales = leerMateriales(localStorage);
    aviso.hidden = !materialesDanados(localStorage);
    llenarMateriales();
  });

  mostrar();
  return {
    fijarPerfil(p) {
      perfil = p;
      if (proyecto) {
        const a = areaActual();
        lienzo.fijarArea(a.ancho, a.alto);
        pintarTodo();
      }
    },
  };
}
