// Panel de vectorizar (fase 1b): JPG/PNG -> potrace en un Web Worker -> vista previa en vivo ->
// figuras editables en una sola capa. El grabado de fotos (raster) es de la fase 3.
import { leerCabecera, MAX_BYTES_IMAGEN, MAX_LADO_PX, DPI_POR_DEFECTO } from '../vectorizar/imagen';
import { importacionDeTrazado, LIMITES_TRAZADO, OPCIONES_POR_DEFECTO, type OpcionesTrazado } from '../vectorizar/trazar';
import type { PedidoTrazado, RespuestaTrazado } from '../vectorizar/trabajador';
import type { ResultadoImportacion } from '../importar/tipos';

/**
 * Textos de la interfaz. Confirmados por Marketing: ayudaUmbral, invertir, vacio, pesada, aceptar y
 * reducida; el resto, provisionales.
 */
export const TEXTOS_VECTORIZAR = {
  titulo: 'Vectorizar imagen',
  intro: 'Convierte un dibujo en blanco y negro (PNG o JPG) en líneas para cortar o grabar. Lo oscuro se convierte en formas; lo transparente cuenta como fondo.',
  original: 'Imagen',
  resultado: 'Resultado',
  umbral: 'Umbral',
  ayudaUmbral: 'Lo que sea más oscuro que este valor (0 a 255) se convierte en forma.',
  invertir: 'Invertir (lo claro se vuelve forma)',
  suavizado: 'Suavizado de esquinas',
  manchas: 'Quitar manchas (px)',
  ayudaManchas: 'Descarta puntos y agujeritos de hasta este tamaño en píxeles.',
  desenfoque: 'Desenfoque (px)',
  ayudaDesenfoque: 'Opcional: suaviza el ruido antes de aplicar el umbral. 0 = sin desenfoque.',
  medida: (ancho: number, alto: number, dpi: number, propio: boolean, mmAncho: string, mmAlto: string) =>
    `${ancho} × ${alto} px a ${dpi} ppp${propio ? '' : ' (la imagen no indica su resolución)'}: ${mmAncho} × ${mmAlto} mm.`,
  trazando: 'Trazando…',
  resumen: (exteriores: number, huecos: number) =>
    `${exteriores === 1 ? '1 forma' : `${exteriores} formas`} y ${huecos === 1 ? '1 hueco' : `${huecos} huecos`}.`,
  vacio: 'Con estos ajustes no queda ninguna forma. Prueba con otro umbral o cambia «Invertir».',
  aceptar: 'Agregar al lienzo',
  cancelar: 'Cancelar',
  reducida: (ancho: number, alto: number, ancho2: number, alto2: number) =>
    `La imagen medía ${ancho} × ${alto} px y se redujo a ${ancho2} × ${alto2} px, el máximo es ${MAX_LADO_PX} px por lado.`,
  pesada: `La imagen pasa de ${MAX_BYTES_IMAGEN / 1_000_000} MB. Usa una versión más ligera.`,
  noImagen: 'No se pudo leer la imagen. Usa un archivo PNG o JPG.',
  errorTrazar: (m: string) => `No se pudo vectorizar la imagen: ${m}`,
} as const;
const T = TEXTOS_VECTORIZAR;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...hijos: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  e.append(...hijos);
  return e;
}

const fmtMm = (n: number) => (Math.round(n * 10) / 10).toLocaleString('es');

export const esImagen = (nombre: string) => /\.(png|jpe?g)$/i.test(nombre);

/** Medida a la que se decodifica: igual si cabe; si no, el lado mayor a MAX_LADO_PX y la misma proporción. */
export function medidaReducida(ancho: number, alto: number): { ancho: number; alto: number; reducida: boolean } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= MAX_LADO_PX) return { ancho, alto, reducida: false };
  const f = MAX_LADO_PX / mayor;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)), reducida: true };
}

export interface ApiVectorizar {
  /** Abre el panel con un archivo. Devuelve un mensaje de error si no se puede usar. */
  abrir(f: File): Promise<string | null>;
  cerrar(): void;
}

/**
 * Monta el panel. `aceptar` recibe las figuras (en mm, origen abajo a la izquierda de la imagen)
 * y el nombre del archivo.
 */
export function montarVectorizar(raiz: HTMLElement, aceptar: (r: ResultadoImportacion, nombre: string) => void): ApiVectorizar {
  const panel = h('section', { class: 'panel cut tarjeta vectorizar', 'data-testid': 'panel-trazado', 'aria-labelledby': 't-vectorizar', hidden: '' });
  const nombreArchivo = h('p', { class: 'nota', 'data-testid': 'trazado-medida' });
  const imgOriginal = h('img', { alt: T.original, 'data-testid': 'trazado-original' });
  const vista = h('div', { class: 'vista-trazado', 'data-testid': 'trazado-vista', role: 'img', 'aria-label': T.resultado });
  const estado = h('p', { 'data-testid': 'trazado-estado', role: 'status' });
  const aviso = h('p', { class: 'aviso-exportar', 'data-testid': 'trazado-aviso', role: 'status', hidden: '' });

  const rango = (id: string, min: number, max: number, paso: number, valor: number) => {
    const r = h('input', { type: 'range', id: `${id}-rango`, 'data-testid': `${id}-rango`, min: String(min), max: String(max), step: String(paso), value: String(valor), 'aria-hidden': 'true', tabindex: '-1' });
    const n = h('input', { type: 'number', id, 'data-testid': id, min: String(min), max: String(max), step: String(paso), value: String(valor), inputmode: 'decimal' });
    r.addEventListener('input', () => {
      n.value = r.value;
      pedir();
    });
    n.addEventListener('input', () => {
      if (n.value !== '' && Number.isFinite(Number(n.value))) r.value = n.value;
      pedir();
    });
    return { r, n };
  };
  const D = OPCIONES_POR_DEFECTO;
  const L = LIMITES_TRAZADO;
  const umbral = rango('trazado-umbral', L.umbral[0], L.umbral[1], 1, D.umbral);
  const suavizado = rango('trazado-suavizado', L.suavizado[0], L.suavizado[1], 0.01, D.suavizado);
  const desenfoque = rango('trazado-desenfoque', L.desenfoque[0], L.desenfoque[1], 1, D.desenfoque);
  const manchas = h('input', { type: 'number', id: 'trazado-manchas', 'data-testid': 'trazado-manchas', min: String(L.manchas[0]), max: String(L.manchas[1]), step: '1', value: String(D.manchas), inputmode: 'numeric' });
  manchas.addEventListener('input', () => pedir());
  const invertir = h('input', { type: 'checkbox', id: 'trazado-invertir', 'data-testid': 'trazado-invertir' });
  invertir.addEventListener('change', () => pedir());
  const btnAceptar = h('button', { type: 'button', class: 'btn btn-orange', 'data-testid': 'trazado-aceptar', text: T.aceptar, disabled: '' });
  const btnCancelar = h('button', { type: 'button', class: 'btn btn-ghost', 'data-testid': 'trazado-cancelar', text: T.cancelar });

  const campo = (id: string, etiqueta: string, ayuda: string | null, ...control: HTMLElement[]) =>
    h('div', { class: 'campo' }, h('label', { for: id, text: etiqueta }), ...control, ...(ayuda ? [h('p', { class: 'nota', text: ayuda })] : []));

  panel.append(
    h('h3', { id: 't-vectorizar', text: T.titulo }),
    h('p', { class: 'nota', text: T.intro }),
    nombreArchivo,
    aviso,
    h(
      'div',
      { class: 'trazado-cuerpo' },
      h(
        'div',
        { class: 'trazado-previas' },
        h('figure', {}, h('figcaption', { text: T.original }), h('div', { class: 'vista-trazado' }, imgOriginal)),
        h('figure', {}, h('figcaption', { text: T.resultado }), vista),
      ),
      h(
        'div',
        { class: 'trazado-controles' },
        campo('trazado-umbral', T.umbral, T.ayudaUmbral, umbral.r, umbral.n),
        h('label', { class: 'check' }, invertir, T.invertir),
        campo('trazado-suavizado', T.suavizado, null, suavizado.r, suavizado.n),
        campo('trazado-manchas', T.manchas, T.ayudaManchas, manchas),
        campo('trazado-desenfoque', T.desenfoque, T.ayudaDesenfoque, desenfoque.r, desenfoque.n),
        estado,
        h('div', { class: 'fila' }, btnAceptar, btnCancelar),
      ),
    ),
  );
  raiz.append(panel);

  let trabajador: Worker | null = null;
  let imagen: { rgba: Uint8ClampedArray; ancho: number; alto: number; dpi: number | null; nombre: string } | null = null;
  let urlOriginal = '';
  let ultimoId = 0;
  let imagenId = 0;
  let enviada = 0;
  let ultimo: RespuestaTrazado | null = null;
  let espera = 0;

  const numero = (el: HTMLInputElement, [min, max]: readonly [number, number], defecto: number) => {
    const v = Number(el.value);
    return el.value.trim() !== '' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : defecto;
  };
  const opciones = (): OpcionesTrazado => ({
    umbral: numero(umbral.n, L.umbral, D.umbral),
    invertir: invertir.checked,
    suavizado: numero(suavizado.n, L.suavizado, D.suavizado),
    manchas: Math.round(numero(manchas, L.manchas, D.manchas)),
    desenfoque: Math.round(numero(desenfoque.n, L.desenfoque, D.desenfoque)),
  });

  function obtenerTrabajador(): Worker {
    if (!trabajador) {
      trabajador = new Worker(new URL('../vectorizar/trabajador.ts', import.meta.url), { type: 'module' });
      trabajador.onmessage = (e: MessageEvent<RespuestaTrazado>) => recibir(e.data);
      trabajador.onerror = (e) => {
        enviada = 0;
        recibir({ id: ultimoId, ok: false, error: e.message || 'error del Worker' });
      };
    }
    return trabajador;
  }

  function pedir(): void {
    if (!imagen) return;
    btnAceptar.disabled = true;
    estado.textContent = T.trazando;
    estado.className = '';
    panel.dataset.estado = 'trazando';
    clearTimeout(espera);
    espera = window.setTimeout(() => {
      if (!imagen) return;
      const pedido: PedidoTrazado = { id: ++ultimoId, imagenId, rgba: enviada === imagenId ? undefined : imagen.rgba, ancho: imagen.ancho, alto: imagen.alto, dpi: imagen.dpi, opciones: opciones() };
      obtenerTrabajador().postMessage(pedido);
      enviada = imagenId;
    }, 120);
  }

  function recibir(r: RespuestaTrazado): void {
    if (r.id !== ultimoId || !imagen) return; // respuesta de un pedido viejo
    ultimo = r;
    panel.dataset.estado = 'listo';
    if (!r.ok) {
      estado.textContent = T.errorTrazar(r.error);
      estado.className = 'errores';
      vista.replaceChildren();
      return;
    }
    vista.innerHTML = r.svg;
    const svg = vista.querySelector('svg');
    svg?.setAttribute('data-testid', 'trazado-svg');
    svg?.removeAttribute('width');
    svg?.removeAttribute('height');
    const { exteriores, huecos } = r.resultado;
    estado.textContent = exteriores ? T.resumen(exteriores, huecos) : T.vacio;
    estado.className = exteriores ? 'ok' : 'errores';
    btnAceptar.disabled = !exteriores;
  }

  function cerrar(): void {
    imagen = null;
    ultimo = null;
    ultimoId++;
    clearTimeout(espera);
    panel.hidden = true;
    delete panel.dataset.estado;
    vista.replaceChildren();
    if (urlOriginal) URL.revokeObjectURL(urlOriginal);
    urlOriginal = '';
  }

  btnCancelar.addEventListener('click', cerrar);
  btnAceptar.addEventListener('click', () => {
    if (!imagen || !ultimo?.ok) return;
    const nombre = imagen.nombre;
    const r = importacionDeTrazado(ultimo.resultado);
    cerrar();
    aceptar(r, nombre);
  });

  /**
   * Decodifica la imagen. Si pasa de MAX_LADO_PX por lado, el navegador la reduce al decodificar
   * (createImageBitmap con resizeWidth/resizeHeight, fuera del hilo de la interfaz), con la misma
   * proporción.
   */
  async function decodificar(f: File, red: { ancho: number; alto: number; reducida: boolean }): Promise<ImageData> {
    const opciones: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
    if (red.reducida) Object.assign(opciones, { resizeWidth: red.ancho, resizeHeight: red.alto, resizeQuality: 'high' });
    const bmp = await createImageBitmap(f, opciones);
    const lienzo = document.createElement('canvas');
    lienzo.width = bmp.width;
    lienzo.height = bmp.height;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx.getImageData(0, 0, lienzo.width, lienzo.height);
  }

  return {
    cerrar,
    async abrir(f) {
      if (f.size > MAX_BYTES_IMAGEN) return T.pesada;
      const cab = leerCabecera(new Uint8Array(await f.slice(0, 256 * 1024).arrayBuffer()));
      if (!cab) return T.noImagen;
      const red = medidaReducida(cab.ancho, cab.alto);
      let datos: ImageData;
      try {
        datos = await decodificar(f, red);
      } catch {
        return T.noImagen;
      }
      if (datos.width > MAX_LADO_PX || datos.height > MAX_LADO_PX) return T.noImagen;
      cerrar();
      imagenId++;
      // Al reducir se conserva el tamaño en mm: los ppp bajan en la misma proporción.
      const factor = datos.width / cab.ancho;
      const dpiOriginal = cab.dpi ?? DPI_POR_DEFECTO;
      const dpi = dpiOriginal * factor;
      imagen = { rgba: datos.data, ancho: datos.width, alto: datos.height, dpi: cab.dpi === null && !red.reducida ? null : dpi, nombre: f.name };
      const k = 25.4 / dpi;
      nombreArchivo.textContent = `«${f.name}»: ${T.medida(datos.width, datos.height, Math.round(dpi * 10) / 10, cab.dpi !== null, fmtMm(datos.width * k), fmtMm(datos.height * k))}`;
      aviso.textContent = red.reducida ? T.reducida(cab.ancho, cab.alto, datos.width, datos.height) : '';
      aviso.hidden = !red.reducida;
      urlOriginal = URL.createObjectURL(f);
      imgOriginal.src = urlOriginal;
      panel.hidden = false;
      pedir();
      panel.scrollIntoView({ block: 'nearest' });
      return null;
    },
  };
}
