// Lienzo SVG del proyecto: área de trabajo en mm, figuras, selección y edición con
// pointer events (ratón y táctil). Las coordenadas del diseño tienen Y hacia arriba.
import type { Punto } from '../gcode/types';
import { aplicar, rotacion } from '../diseno/geometria';
import { matrizFigura, cajaFigura, figuraFuera, type CapaProyecto, type Figura } from '../diseno/proyecto';
import {
  cajaSeleccion,
  escalarDesdeTirador,
  escalarGrupo,
  mover,
  normalizarAngulo,
  rotarAlrededor,
  tamanoFigura,
} from '../diseno/edicion';

const NS = 'http://www.w3.org/2000/svg';
/** Márgenes en px de pantalla al ajustar la vista: izquierda y abajo dejan sitio a las reglas. */
const PAD = { izq: 46, der: 14, arriba: 14, abajo: 28 } as const;
/** Bandas de las reglas (px de pantalla). */
const BANDA_IZQ_PX = 40;
const BANDA_ABAJO_PX = 20;
const FUENTE_PX = 11;
/** Límites de zoom: como mucho 60 px por mm; como poco, la mitad de la vista ajustada. */
const MAX_PX_POR_MM = 60;
const MIN_ZOOM_RELATIVO = 0.5;
/** Pasos posibles entre etiquetas de las reglas (mm). */
const PASOS_REGLA = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
/** Tamaño de los tiradores en px de pantalla. */
const TIRADOR_PX = 14;
/** Desplazamiento mínimo (px) para que un toque cuente como arrastre. */
const UMBRAL_PX = 3;

type Arrastre =
  | { tipo: 'mover'; inicio: Punto; base: Figura[]; movido: boolean; idTocado: string | null; shift: boolean }
  | { tipo: 'caja'; inicio: Punto; actual: Punto; shift: boolean; previa: Set<string> }
  | { tipo: 'escalar'; ux: number; uy: number; base: Figura[]; desfase: Punto }
  | { tipo: 'rotar'; centro: Punto; anguloInicio: number; base: Figura[]; anguloFigura: number }
  | { tipo: 'pan'; ultimo: { x: number; y: number } }
  | { tipo: 'gesto'; d0: number; m0: { x: number; y: number }; vista0: Vista }
  /** Quedó un dedo tras un gesto de dos dedos: no hace nada hasta levantarlo. */
  | { tipo: 'espera' };

/** Rectángulo visible en coordenadas del SVG (mm; Y hacia abajo). */
interface Vista {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EventosLienzo {
  /** Las figuras cambiaron (final = true al soltar). */
  cambio(figuras: Figura[], final: boolean): void;
  seleccion(ids: Set<string>): void;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class Lienzo {
  readonly svg: SVGSVGElement;
  private mundo: SVGGElement;
  private capaFiguras: SVGGElement;
  private capaSeleccion: SVGGElement;
  private reglas: SVGGElement;
  private ancho = 0;
  private alto = 0;
  private figuras: Figura[] = [];
  private capas: CapaProyecto[] = [];
  private sel = new Set<string>();
  private arrastre: Arrastre | null = null;
  private punteroId: number | null = null;
  private inicioPx: { x: number; y: number } | null = null;
  private vista: Vista = { x: 0, y: 0, w: 100, h: 100 };
  private ajustada = true;
  /** Punteros táctiles activos (para el gesto de dos dedos). */
  private toques = new Map<number, { x: number; y: number }>();
  /** Barra espaciadora pulsada: arrastrar mueve la vista. */
  private espacio = false;

  constructor(
    contenedor: HTMLElement,
    private eventos: EventosLienzo,
  ) {
    this.svg = el('svg', { 'data-testid': 'lienzo', class: 'lienzo', tabindex: 0, role: 'application', 'aria-label': 'Lienzo del área de trabajo' });
    this.reglas = el('g', { class: 'reglas' });
    this.mundo = el('g');
    this.capaFiguras = el('g', { class: 'figuras' });
    this.capaSeleccion = el('g', { class: 'seleccion' });
    this.svg.append(this.mundo, this.reglas);
    contenedor.append(this.svg);
    this.svg.addEventListener('wheel', (e) => this.alRueda(e), { passive: false });
    this.svg.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.espacio = false;
    });
    this.svg.addEventListener('blur', () => (this.espacio = false));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.alRedimensionar()).observe(this.svg);
    this.svg.addEventListener('pointerdown', (e) => this.alPulsar(e));
    this.svg.addEventListener('pointermove', (e) => this.alMover(e));
    this.svg.addEventListener('pointerup', (e) => this.alSoltar(e));
    this.svg.addEventListener('pointercancel', (e) => this.alSoltar(e, true));
    this.svg.addEventListener('keydown', (e) => this.alTeclear(e));
  }

  /** Tamaño del área en mm. Redibuja el fondo y la cuadrícula, y ajusta la vista. */
  fijarArea(ancho: number, alto: number): void {
    this.ancho = ancho;
    this.alto = alto;
    // Proporción del recuadro: la del área, sin pasar de 2:1 ni de 1:1,6.
    this.svg.style.aspectRatio = String(Math.min(2, Math.max(1 / 1.6, (ancho + 60) / (alto + 42))));
    this.mundo.setAttribute('transform', `matrix(1 0 0 -1 0 ${alto})`);
    this.mundo.replaceChildren();
    this.mundo.append(el('rect', { class: 'area', 'data-testid': 'lienzo-area', x: 0, y: 0, width: ancho, height: alto }));
    const rejilla = el('g', { class: 'rejilla' });
    // Rejilla fina de 1 mm (solo se ve con zoom), media de 10 mm y mayor de 50 mm.
    if (Math.max(ancho, alto) <= 1000) {
      const fina = el('g', { class: 'fina' });
      for (let x = 1; x < ancho; x++) if (x % 10) fina.append(el('line', { x1: x, y1: 0, x2: x, y2: alto }));
      for (let y = 1; y < alto; y++) if (y % 10) fina.append(el('line', { x1: 0, y1: y, x2: ancho, y2: y }));
      rejilla.append(fina);
    }
    const paso = Math.max(ancho, alto) > 1000 ? 50 : 10;
    for (let x = paso; x < ancho; x += paso)
      rejilla.append(el('line', { x1: x, y1: 0, x2: x, y2: alto, class: x % (paso * 5) === 0 ? 'mayor' : '' }));
    for (let y = paso; y < alto; y += paso)
      rejilla.append(el('line', { x1: 0, y1: y, x2: ancho, y2: y, class: y % (paso * 5) === 0 ? 'mayor' : '' }));
    this.mundo.append(rejilla, this.capaFiguras, this.capaSeleccion);
    this.ajustar();
  }

  // --- Vista: zoom y desplazamiento ------------------------------------------------

  private tamPx(): { w: number; h: number } {
    const r = this.svg.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  /** mm por px de la vista ajustada (todo el área a la vista). */
  private kAjuste(): number {
    const { w, h } = this.tamPx();
    if (w < 20 || h < 20) return Math.max(this.ancho, this.alto, 1) / 300;
    return Math.max(this.ancho / Math.max(10, w - PAD.izq - PAD.der), this.alto / Math.max(10, h - PAD.arriba - PAD.abajo));
  }

  /** Vuelve a ver el área completa. */
  ajustar(): void {
    const { w, h } = this.tamPx();
    const W = w < 20 ? 300 : w;
    const H = h < 20 ? 300 : h;
    const k = this.kAjuste();
    const libreX = (W - PAD.izq - PAD.der) * k - this.ancho;
    const libreY = (H - PAD.arriba - PAD.abajo) * k - this.alto;
    this.vista = { x: -PAD.izq * k - libreX / 2, y: -PAD.arriba * k - libreY / 2, w: W * k, h: H * k };
    this.ajustada = true;
    this.aplicarVista();
  }

  /** Zoom por un factor (>1 acerca) manteniendo fijo el punto de pantalla (cx, cy). */
  zoom(factor: number, cx?: number, cy?: number): void {
    const r = this.svg.getBoundingClientRect();
    if (r.width < 20) return;
    const k0 = this.vista.w / r.width;
    const k = this.limitarK(k0 / factor);
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    const u = { x: this.vista.x + px * k0, y: this.vista.y + py * k0 };
    this.vista = { x: u.x - px * k, y: u.y - py * k, w: r.width * k, h: r.height * k };
    this.ajustada = false;
    this.aplicarVista();
  }

  /** Factor de zoom actual respecto a la vista ajustada (1 = ajustada). */
  nivelZoom(): number {
    const { w } = this.tamPx();
    return w < 20 ? 1 : this.kAjuste() / (this.vista.w / w);
  }

  private limitarK(k: number): number {
    return Math.min(this.kAjuste() / MIN_ZOOM_RELATIVO, Math.max(1 / MAX_PX_POR_MM, k));
  }

  private desplazarPx(dx: number, dy: number): void {
    const { w } = this.tamPx();
    if (w < 20) return;
    const k = this.vista.w / w;
    this.vista = { ...this.vista, x: this.vista.x - dx * k, y: this.vista.y - dy * k };
    this.ajustada = false;
    this.aplicarVista();
  }

  private alRedimensionar(): void {
    const { w, h } = this.tamPx();
    if (w < 20 || h < 20) return;
    if (this.ajustada) return this.ajustar();
    const k = this.vista.w / Math.max(1, this.ultimoAncho || w);
    const cx = this.vista.x + this.vista.w / 2;
    const cy = this.vista.y + this.vista.h / 2;
    this.vista = { x: cx - (w * k) / 2, y: cy - (h * k) / 2, w: w * k, h: h * k };
    this.aplicarVista();
  }

  private ultimoAncho = 0;

  private aplicarVista(): void {
    const v = this.vista;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    this.ultimoAncho = this.tamPx().w;
    const k = this.ultimoAncho >= 20 ? v.w / this.ultimoAncho : this.kAjuste();
    this.svg.classList.toggle('con-detalle', 1 / k >= 6);
    this.svg.dataset.zoom = this.nivelZoom().toFixed(3);
    this.dibujarReglas(k);
    this.dibujar();
  }

  /** Reglas en mm, pegadas a los bordes izquierdo e inferior de la vista. */
  private dibujarReglas(k: number): void {
    const v = this.vista;
    this.reglas.replaceChildren();
    const fuente = FUENTE_PX * k;
    const bandaIzq = BANDA_IZQ_PX * k;
    const bandaAbajo = BANDA_ABAJO_PX * k;
    const yBanda = v.y + v.h - bandaAbajo;
    this.reglas.append(
      el('rect', { class: 'banda', x: v.x, y: yBanda, width: v.w, height: bandaAbajo }),
      el('rect', { class: 'banda', x: v.x, y: v.y, width: bandaIzq, height: v.h }),
    );
    const paso = PASOS_REGLA.find((p) => p / k >= 50) ?? PASOS_REGLA[PASOS_REGLA.length - 1];
    const base = yBanda + bandaAbajo / 2 + fuente * 0.35;
    for (let x = Math.ceil(v.x / paso) * paso; x <= v.x + v.w; x += paso) {
      if (x < 0 || x > this.ancho + 1e-9) continue;
      if (x - fuente * 1.6 < v.x + bandaIzq) continue;
      const t = el('text', { x, y: base, 'font-size': fuente, 'text-anchor': 'middle', 'data-testid': 'regla-x' });
      t.textContent = String(x);
      this.reglas.append(t);
    }
    // En el SVG la Y va hacia abajo: y_svg = alto - y.
    for (let y = Math.ceil((this.alto - (v.y + v.h)) / paso) * paso; this.alto - y >= v.y; y += paso) {
      if (y < 0 || y > this.alto + 1e-9) continue;
      const ys = this.alto - y;
      if (ys + fuente * 0.6 > yBanda || ys - fuente * 0.6 < v.y) continue;
      const t = el('text', { x: v.x + bandaIzq - 5 * k, y: ys + fuente * 0.35, 'font-size': fuente, 'text-anchor': 'end', 'data-testid': 'regla-y' });
      t.textContent = String(y);
      this.reglas.append(t);
    }
    // «mm» en la esquina donde se cruzan las dos reglas: no tapa ninguna etiqueta.
    const u = el('text', { x: v.x + bandaIzq / 2, y: base, 'font-size': fuente, 'text-anchor': 'middle', 'data-testid': 'regla-mm' });
    u.textContent = 'mm';
    this.reglas.append(u);
  }

  private alRueda(e: WheelEvent): void {
    e.preventDefault();
    const unidad = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // La rueda (y el pellizco del trackpad, que llega como rueda con Ctrl) acerca o aleja.
    const factor = Math.exp((-e.deltaY * unidad * (e.ctrlKey ? 4 : 1)) / 600);
    this.zoom(Math.min(4, Math.max(0.25, factor)), e.clientX, e.clientY);
  }

  actualizar(figuras: Figura[], capas: CapaProyecto[], sel: Set<string>): void {
    this.figuras = figuras;
    this.capas = capas;
    this.sel = new Set([...sel].filter((id) => figuras.some((f) => f.id === id && this.visible(f))));
    this.dibujar();
  }

  seleccion(): Set<string> {
    return new Set(this.sel);
  }

  private visible(f: Figura): boolean {
    return this.capas.find((c) => c.color === f.color)?.visible !== false;
  }

  /** mm de diseño por px de pantalla. */
  private mmPorPx(): number {
    const ctm = this.mundo.getScreenCTM();
    return ctm && ctm.a ? 1 / Math.abs(ctm.a) : 1;
  }

  private aDiseno(e: { clientX: number; clientY: number }): Punto {
    const ctm = this.mundo.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  private dibujar(): void {
    this.capaFiguras.replaceChildren();
    for (const f of this.figuras) {
      if (!this.visible(f)) continue;
      const m = matrizFigura(f);
      let d = '';
      for (const t of f.trazos) {
        d += t.puntos.map((p, i) => {
          const q = aplicar(m, p);
          return `${i ? 'L' : 'M'}${r3(q.x)} ${r3(q.y)}`;
        }).join('');
        if (t.cerrado) d += 'Z';
      }
      const g = el('g', { class: `figura${this.sel.has(f.id) ? ' seleccionada' : ''}${figuraFuera(f, { ancho: this.ancho, alto: this.alto }) ? ' fuera' : ''}`, 'data-id': f.id, 'data-testid': 'figura' });
      // Trazo ancho invisible para poder tocar líneas finas; el relleno transparente permite tocar por dentro.
      g.append(el('path', { d, class: 'toque' }), el('path', { d, class: 'trazo', stroke: f.color }));
      this.capaFiguras.append(g);
    }
    this.dibujarSeleccion();
  }

  private dibujarSeleccion(): void {
    this.capaSeleccion.replaceChildren();
    const sel = this.figuras.filter((f) => this.sel.has(f.id));
    const a = this.arrastre;
    if (a?.tipo === 'caja') {
      const x = Math.min(a.inicio.x, a.actual.x);
      const y = Math.min(a.inicio.y, a.actual.y);
      this.capaSeleccion.append(el('rect', { class: 'recuadro', 'data-testid': 'recuadro', x, y, width: Math.abs(a.actual.x - a.inicio.x), height: Math.abs(a.actual.y - a.inicio.y) }));
    }
    if (!sel.length) return;
    const h = TIRADOR_PX * this.mmPorPx();
    const esquinas: { ux: number; uy: number; p: Punto }[] = [];
    let marco: Punto[];
    let arriba: Punto;
    let dirArriba: Punto;
    if (sel.length === 1) {
      const f = sel[0];
      const { ancho, alto } = tamanoFigura(f);
      const r = rotacion(f.angulo);
      const loc = (ux: number, uy: number, fuera = 0) => {
        const q = aplicar(r, { x: (ux * ancho) / 2 + ux * fuera, y: (uy * alto) / 2 + uy * fuera });
        return { x: f.x + q.x, y: f.y + q.y };
      };
      marco = [loc(-1, -1), loc(1, -1), loc(1, 1), loc(-1, 1)];
      for (const ux of [-1, 0, 1])
        for (const uy of [-1, 0, 1]) {
          if (ux === 0 && uy === 0) continue;
          if ((ux === 0 && f.ancho0 === 0) || (uy === 0 && f.alto0 === 0)) continue;
          // Los tiradores van por fuera del marco: así no tapan figuras pequeñas.
          esquinas.push({ ux, uy, p: loc(ux, uy, h * 0.75) });
        }
      arriba = loc(0, 1);
      dirArriba = aplicar(r, { x: 0, y: 1 });
    } else {
      const c = cajaSeleccion(this.figuras, this.sel)!;
      marco = [
        { x: c.xMin, y: c.yMin },
        { x: c.xMax, y: c.yMin },
        { x: c.xMax, y: c.yMax },
        { x: c.xMin, y: c.yMax },
      ];
      for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        esquinas.push({ ux, uy, p: { x: (ux < 0 ? c.xMin : c.xMax) + ux * h * 0.75, y: (uy < 0 ? c.yMin : c.yMax) + uy * h * 0.75 } });
      arriba = { x: (c.xMin + c.xMax) / 2, y: c.yMax };
      dirArriba = { x: 0, y: 1 };
    }
    this.capaSeleccion.append(el('polygon', { class: 'marco', 'data-testid': 'marco-seleccion', points: marco.map((p) => `${r3(p.x)},${r3(p.y)}`).join(' ') }));
    const giro = { x: arriba.x + dirArriba.x * h * 2.6, y: arriba.y + dirArriba.y * h * 2.6 };
    this.capaSeleccion.append(el('line', { class: 'marco', x1: arriba.x, y1: arriba.y, x2: giro.x, y2: giro.y }));
    this.capaSeleccion.append(el('circle', { class: 'tirador giro', 'data-testid': 'tirador-giro', 'data-tirador': 'giro', cx: giro.x, cy: giro.y, r: h / 2 }));
    for (const e of esquinas)
      this.capaSeleccion.append(
        el('rect', { class: 'tirador', 'data-testid': `tirador-${e.ux}_${e.uy}`, 'data-tirador': `${e.ux},${e.uy}`, x: e.p.x - h / 2, y: e.p.y - h / 2, width: h, height: h }),
      );
  }

  /** Punto del marco que corresponde al tirador (ux, uy), sin el desplazamiento hacia fuera. */
  private esquinaReal(ux: number, uy: number): Punto {
    const s = this.figuras.filter((f) => this.sel.has(f.id));
    if (s.length === 1) {
      const f = s[0];
      const { ancho, alto } = tamanoFigura(f);
      const q = aplicar(rotacion(f.angulo), { x: (ux * ancho) / 2, y: (uy * alto) / 2 });
      return { x: f.x + q.x, y: f.y + q.y };
    }
    const c = cajaSeleccion(this.figuras, this.sel)!;
    return { x: ux < 0 ? c.xMin : ux > 0 ? c.xMax : (c.xMin + c.xMax) / 2, y: uy < 0 ? c.yMin : uy > 0 ? c.yMax : (c.yMin + c.yMax) / 2 };
  }

  private emitirSeleccion(): void {
    this.eventos.seleccion(new Set(this.sel));
  }

  private alPulsar(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.toques.size === 2) return this.empezarGesto(e);
      if (this.toques.size > 2) return;
    }
    if (this.punteroId !== null) return;
    if (e.pointerType === 'mouse' && e.button === 1) {
      // Botón central: mover la vista.
      this.empezarPan(e);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.svg.focus({ preventScroll: true });
    if (this.espacio) {
      this.empezarPan(e);
      return;
    }
    const p = this.aDiseno(e);
    const objetivo = e.target as Element;
    const tirador = objetivo.closest('[data-tirador]')?.getAttribute('data-tirador');
    const idFigura = objetivo.closest('[data-id]')?.getAttribute('data-id') ?? null;
    if (tirador === 'giro') {
      const s = this.figuras.filter((f) => this.sel.has(f.id));
      const c = s.length === 1 ? { x: s[0].x, y: s[0].y } : (() => { const b = cajaSeleccion(this.figuras, this.sel)!; return { x: (b.xMin + b.xMax) / 2, y: (b.yMin + b.yMax) / 2 }; })();
      this.arrastre = { tipo: 'rotar', centro: c, anguloInicio: Math.atan2(p.y - c.y, p.x - c.x), base: this.figuras, anguloFigura: s.length === 1 ? s[0].angulo : 0 };
    } else if (tirador) {
      const [ux, uy] = tirador.split(',').map(Number);
      // Desfase entre el puntero y la esquina real del marco (el tirador está por fuera).
      const esquina = this.esquinaReal(ux, uy);
      this.arrastre = { tipo: 'escalar', ux, uy, base: this.figuras, desfase: { x: esquina.x - p.x, y: esquina.y - p.y } };
    } else if (idFigura) {
      if (e.shiftKey) {
        if (this.sel.has(idFigura)) this.sel.delete(idFigura);
        else this.sel.add(idFigura);
      } else if (!this.sel.has(idFigura)) this.sel = new Set([idFigura]);
      this.arrastre = { tipo: 'mover', inicio: p, base: this.figuras, movido: false, idTocado: idFigura, shift: e.shiftKey };
      this.emitirSeleccion();
      this.dibujar();
    } else {
      this.arrastre = { tipo: 'caja', inicio: p, actual: p, shift: e.shiftKey, previa: new Set(this.sel) };
      if (!e.shiftKey) {
        this.sel.clear();
        this.emitirSeleccion();
        this.dibujar();
      }
    }
    this.punteroId = e.pointerId;
    this.inicioPx = { x: e.clientX, y: e.clientY };
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private empezarPan(e: PointerEvent): void {
    this.arrastre = { tipo: 'pan', ultimo: { x: e.clientX, y: e.clientY } };
    this.punteroId = e.pointerId;
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  /** Segundo dedo: se anula lo que hacía el primero y empieza el zoom/desplazamiento. */
  private empezarGesto(e: PointerEvent): void {
    const a = this.arrastre;
    if (a && 'base' in a) {
      this.figuras = a.base;
      this.eventos.cambio(this.figuras, true);
    } else if (a?.tipo === 'caja') {
      this.sel = a.previa;
      this.emitirSeleccion();
    }
    const [p, q] = [...this.toques.values()];
    this.arrastre = { tipo: 'gesto', d0: Math.max(1, Math.hypot(q.x - p.x, q.y - p.y)), m0: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, vista0: { ...this.vista } };
    this.punteroId = null;
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.dibujar();
  }

  private moverGesto(a: { d0: number; m0: { x: number; y: number }; vista0: Vista }): void {
    const [p, q] = [...this.toques.values()];
    const r = this.svg.getBoundingClientRect();
    if (r.width < 20) return;
    const d = Math.max(1, Math.hypot(q.x - p.x, q.y - p.y));
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const k0 = a.vista0.w / r.width;
    const k = this.limitarK((k0 * a.d0) / d);
    const u = { x: a.vista0.x + (a.m0.x - r.left) * k0, y: a.vista0.y + (a.m0.y - r.top) * k0 };
    this.vista = { x: u.x - (m.x - r.left) * k, y: u.y - (m.y - r.top) * k, w: r.width * k, h: r.height * k };
    this.ajustada = false;
    this.aplicarVista();
  }

  private alMover(e: PointerEvent): void {
    if (e.pointerType === 'touch' && this.toques.has(e.pointerId)) this.toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const a = this.arrastre;
    if (a?.tipo === 'gesto') {
      if (this.toques.size === 2 && this.toques.has(e.pointerId)) this.moverGesto(a);
      return;
    }
    if (!a || e.pointerId !== this.punteroId) return;
    if (a.tipo === 'pan') {
      this.desplazarPx(e.clientX - a.ultimo.x, e.clientY - a.ultimo.y);
      a.ultimo = { x: e.clientX, y: e.clientY };
      return;
    }
    if (a.tipo === 'espera') return;
    const p = this.aDiseno(e);
    const lejos = this.inicioPx ? Math.hypot(e.clientX - this.inicioPx.x, e.clientY - this.inicioPx.y) >= UMBRAL_PX : true;
    switch (a.tipo) {
      case 'mover': {
        if (!lejos && !a.movido) return;
        if (a.shift && !this.sel.size) return;
        a.movido = true;
        this.figuras = mover(a.base, this.sel, p.x - a.inicio.x, p.y - a.inicio.y);
        break;
      }
      case 'caja': {
        a.actual = p;
        const xMin = Math.min(a.inicio.x, p.x);
        const xMax = Math.max(a.inicio.x, p.x);
        const yMin = Math.min(a.inicio.y, p.y);
        const yMax = Math.max(a.inicio.y, p.y);
        const dentro = this.figuras
          .filter((f) => this.visible(f))
          .filter((f) => {
            const c = cajaFigura(f);
            return c && c.xMin >= xMin && c.xMax <= xMax && c.yMin >= yMin && c.yMax <= yMax;
          })
          .map((f) => f.id);
        this.sel = new Set(a.shift ? [...a.previa, ...dentro] : dentro);
        this.emitirSeleccion();
        break;
      }
      case 'escalar': {
        p.x += a.desfase.x;
        p.y += a.desfase.y;
        const s = a.base.filter((f) => this.sel.has(f.id));
        if (s.length === 1) {
          const g = escalarDesdeTirador(s[0], a.ux, a.uy, p, e.shiftKey);
          this.figuras = a.base.map((f) => (f.id === g.id ? g : f));
        } else {
          // Varias: escala uniforme desde la esquina opuesta.
          const c = cajaSeleccion(a.base, this.sel)!;
          const fijo = { x: a.ux < 0 ? c.xMax : c.xMin, y: a.uy < 0 ? c.yMax : c.yMin };
          const w = c.xMax - c.xMin;
          const h = c.yMax - c.yMin;
          const kx = w > 0 ? Math.abs(p.x - fijo.x) / w : 0;
          const ky = h > 0 ? Math.abs(p.y - fijo.y) / h : 0;
          const k = Math.max(0.001, Math.max(kx, ky));
          this.figuras = escalarGrupo(a.base, this.sel, k, fijo);
        }
        break;
      }
      case 'rotar': {
        let delta = ((Math.atan2(p.y - a.centro.y, p.x - a.centro.x) - a.anguloInicio) * 180) / Math.PI;
        if (e.shiftKey) {
          // Saltos de 15° sobre el ángulo final.
          const final = Math.round((a.anguloFigura + delta) / 15) * 15;
          delta = final - a.anguloFigura;
        }
        this.figuras = rotarAlrededor(a.base, this.sel, normalizarAngulo(delta), a.centro);
        break;
      }
    }
    this.dibujar();
    if (a.tipo !== 'caja') this.eventos.cambio(this.figuras, false);
  }

  private alSoltar(e: PointerEvent, cancelado = false): void {
    const eraToque = this.toques.delete(e.pointerId);
    if (this.arrastre?.tipo === 'gesto' || this.arrastre?.tipo === 'espera') {
      if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
      if (!this.toques.size) {
        this.arrastre = null;
        this.punteroId = null;
      } else if (eraToque) this.arrastre = { tipo: 'espera' };
      return;
    }
    if (e.pointerId !== this.punteroId) return;
    const a = this.arrastre;
    this.arrastre = null;
    this.punteroId = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (!a || a.tipo === 'pan') return;
    if (cancelado && a.tipo !== 'caja') {
      this.figuras = a.base;
      this.eventos.cambio(this.figuras, true);
    } else if (a.tipo === 'mover' && !a.movido && !a.shift && a.idTocado && this.sel.size > 1) {
      // Clic sin arrastrar sobre una figura de una selección múltiple: queda solo esa.
      this.sel = new Set([a.idTocado]);
      this.emitirSeleccion();
    } else if (a.tipo !== 'caja' && (a.tipo !== 'mover' || a.movido)) {
      this.eventos.cambio(this.figuras, true);
    }
    this.dibujar();
  }

  private alTeclear(e: KeyboardEvent): void {
    if (e.key === ' ') {
      this.espacio = true;
      e.preventDefault();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '+' || e.key === '=') {
        this.zoom(1.25);
        e.preventDefault();
        return;
      }
      if (e.key === '-') {
        this.zoom(0.8);
        e.preventDefault();
        return;
      }
      if (e.key === '0') {
        this.ajustar();
        e.preventDefault();
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      this.sel = new Set(this.figuras.filter((f) => this.visible(f)).map((f) => f.id));
      this.dibujar();
      this.emitirSeleccion();
      e.preventDefault();
      return;
    }
    if (!this.sel.size) return;
    const paso = e.shiftKey ? 10 : 1;
    const flechas: Record<string, [number, number]> = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, paso], ArrowDown: [0, -paso] };
    if (flechas[e.key]) {
      const [dx, dy] = flechas[e.key];
      this.figuras = mover(this.figuras, this.sel, dx, dy);
      this.dibujar();
      this.eventos.cambio(this.figuras, true);
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      this.figuras = this.figuras.filter((f) => !this.sel.has(f.id));
      this.sel.clear();
      this.dibujar();
      this.emitirSeleccion();
      this.eventos.cambio(this.figuras, true);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.sel.clear();
      this.dibujar();
      this.emitirSeleccion();
    }
  }
}
