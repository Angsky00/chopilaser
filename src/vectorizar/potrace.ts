// Cargador de potrace.wasm: potracelib 1.16 (Peter Selinger, GPL-2.0-or-later) compilado con
// emscripten por tools/potrace/construir.sh junto con nuestra envoltura (tools/potrace/envoltura.c).
// Sin DOM: funciona en el Worker y en Node (las pruebas le dan los bytes del .wasm).

export interface ParametrosPotrace {
  turdsize: number;
  turnpolicy: number;
  alphamax: number;
  opticurve: boolean;
  opttolerance: number;
}

interface Exportes {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  chopi_trazar(bits: number, w: number, h: number, turdsize: number, turnpolicy: number, alphamax: number, opticurve: number, opttolerance: number): number;
  chopi_salida(): number;
  chopi_reservar(n: number): number;
  chopi_liberar(p: number): void;
}

/** Trayecto de potrace: un grupo (contorno exterior y sus huecos) como datos de un `path` SVG en px, Y hacia arriba. */
export type FnPotrace = (bits: Uint8Array, ancho: number, alto: number, p: ParametrosPotrace) => string[];

let bytesInyectados: BufferSource | null = null;
let cargado: Promise<FnPotrace> | null = null;

/** Para Node (pruebas): los bytes de potrace.wasm, antes de la primera llamada. */
export function fijarBytesPotrace(bytes: BufferSource): void {
  bytesInyectados = bytes;
  cargado = null;
}

async function instanciar(): Promise<Exportes> {
  const imports = { env: { emscripten_notify_memory_growth: () => undefined } };
  let instancia: WebAssembly.Instance;
  if (bytesInyectados) instancia = (await WebAssembly.instantiate(bytesInyectados, imports)).instance;
  else {
    const r = await fetch(new URL('./potrace.wasm', import.meta.url));
    if (!r.ok) throw new Error(`no se pudo cargar potrace.wasm (${r.status})`);
    instancia = (await WebAssembly.instantiate(await r.arrayBuffer(), imports)).instance;
  }
  const e = instancia.exports as unknown as Exportes;
  e._initialize?.();
  return e;
}

const num = (v: number) => {
  const s = v.toFixed(3);
  return s === '-0.000' ? '0.000' : s;
};

/** Carga potrace una sola vez. */
export function cargarPotrace(): Promise<FnPotrace> {
  cargado ??= instanciar().then((e) => (bits, ancho, alto, p) => {
    const ptr = e.chopi_reservar(ancho * alto);
    if (!ptr) throw new Error('sin memoria para la imagen');
    try {
      new Uint8Array(e.memory.buffer, ptr, ancho * alto).set(bits.subarray(0, ancho * alto));
      const n = e.chopi_trazar(ptr, ancho, alto, p.turdsize, p.turnpolicy, p.alphamax, p.opticurve ? 1 : 0, p.opttolerance);
      if (n < 0) throw new Error('potrace no pudo trazar la imagen');
      // Copia: la memoria puede crecer (y cambiar de búfer) en la próxima llamada.
      const d = new Float64Array(e.memory.buffer, e.chopi_salida(), n).slice();
      const grupos: string[] = [];
      let i = 0;
      const nGrupos = d[i++];
      for (let g = 0; g < nGrupos; g++) {
        const caminos = d[i++];
        const partes: string[] = [];
        for (let c = 0; c < caminos; c++) {
          const segs = d[i++];
          partes.push(`M${num(d[i])} ${num(d[i + 1])}`);
          i += 2;
          for (let s = 0; s < segs; s++) {
            const tipo = d[i];
            const v = d.subarray(i + 1, i + 7);
            i += 7;
            if (tipo === 1) partes.push(`C${num(v[0])} ${num(v[1])} ${num(v[2])} ${num(v[3])} ${num(v[4])} ${num(v[5])}`);
            else partes.push(`L${num(v[2])} ${num(v[3])} L${num(v[4])} ${num(v[5])}`);
          }
          partes.push('Z');
        }
        grupos.push(partes.join(' '));
      }
      return grupos;
    } finally {
      e.chopi_liberar(ptr);
    }
  });
  return cargado;
}
