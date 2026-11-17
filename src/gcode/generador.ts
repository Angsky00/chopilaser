// Generador de G-code para GRBL (MKS DLC32 / GRBL_ESP32). Módulo puro.
//
// Garantías de seguridad (las comprueba también tools/gcode_lint.py en el CI):
//  - Cabecera G21 G90 (mm, absoluto).
//  - S0 antes de cada G0, aunque $32 sea 0: nunca hay un G0 con el láser encendido.
//  - F antes del primer G1 de cada trayectoria.
//  - S calculado desde el % y limitado a sMax ($30): 100 % = sMax exacto, 0 % = S0.
//  - Termina siempre con M5 y S0.
//  - El diseño (origen 0,0 abajo a la izquierda) se traslada a la esquina (xMin, yMin)
//    del área de trabajo; las coordenadas usan 3 decimales fijos, sin NaN y siempre dentro del área.
//  - Solo ASCII, sin BOM, fin de línea LF.
import { erroresConfigMaquina } from './config';
import { aMilesimas, milesimasCortas, milesimasFijas } from './formato';
import { ErrorGcode, type AreaTrabajo, type Capa, type ConfigMaquina, type Trabajo } from './types';

/** Límite de S en milésimas, sin pasar nunca de sMax por redondeo. */
function sMaxMilesimas(sMax: number): number {
  let k = Math.floor(sMax * 1000);
  if (k / 1000 > sMax) k -= 1;
  return k;
}

/** Convierte potencia en % a S (texto) con el límite de sMax. */
export function potenciaAS(potencia: number, sMax: number): string {
  if (!Number.isFinite(potencia)) throw new ErrorGcode('La potencia no es un número válido.');
  if (!Number.isFinite(sMax) || sMax <= 0) throw new ErrorGcode('S máximo ($30) no es válido.');
  const tope = sMaxMilesimas(sMax);
  if (tope < 1) throw new ErrorGcode('S máximo ($30) es demasiado pequeño.');
  const pct = Math.min(100, Math.max(0, potencia));
  let k: number;
  if (pct >= 100) k = tope;
  else if (pct <= 0) k = 0;
  else k = Math.min(tope, Math.max(0, Math.round((pct * tope) / 100)));
  return milesimasCortas(k);
}

function validarCapa(capa: Capa, i: number): void {
  const n = i + 1;
  if (!Number.isFinite(capa.potencia)) throw new ErrorGcode(`Capa ${n}: la potencia no es un número.`);
  if (!Number.isFinite(capa.velocidad) || capa.velocidad <= 0)
    throw new ErrorGcode(`Capa ${n}: la velocidad debe ser mayor que 0.`);
  if (aMilesimas(capa.velocidad) < 1) throw new ErrorGcode(`Capa ${n}: la velocidad es demasiado pequeña.`);
  if (!Number.isInteger(capa.pasadas) || capa.pasadas < 1)
    throw new ErrorGcode(`Capa ${n}: las pasadas deben ser un entero mayor o igual a 1.`);
  if (capa.modo !== 'M3' && capa.modo !== 'M4') throw new ErrorGcode(`Capa ${n}: el modo debe ser M3 o M4.`);
}

interface LimitesEje {
  /** Desplazamiento en milésimas (xMin o yMin, redondeado hacia dentro del área). */
  min: number;
  max: number;
}

function limites(area: AreaTrabajo): { x: LimitesEje; y: LimitesEje } {
  const eje = (a: number, b: number): LimitesEje => {
    const min = Math.ceil(a * 1000 - 1e-6);
    const max = Math.floor(b * 1000 + 1e-6);
    return { min: min === 0 ? 0 : min, max: max === 0 ? 0 : max };
  };
  return { x: eje(area.xMin, area.xMax), y: eje(area.yMin, area.yMax) };
}

function coordenada(valor: number, lim: LimitesEje, eje: 'X' | 'Y'): string {
  if (!Number.isFinite(valor)) throw new ErrorGcode(`Coordenada ${eje} no válida (NaN o infinito).`);
  const k = lim.min + aMilesimas(valor);
  if (k < lim.min || k > lim.max)
    throw new ErrorGcode(
      `Coordenada ${eje}${milesimasFijas(k)} fuera del área de trabajo (${milesimasFijas(lim.min)} a ${milesimasFijas(lim.max)}).`,
    );
  return `${eje}${milesimasFijas(k === 0 ? 0 : k)}`;
}

const SOLO_ASCII = /^[\x0A\x20-\x7E]*$/;

export function generarGcode(trabajo: Trabajo, maquina: ConfigMaquina): string {
  const errores = erroresConfigMaquina(maquina);
  if (errores.length > 0) throw new ErrorGcode(errores.join(' '));
  const cfg = maquina;
  const lim = limites(cfg.area);
  const L: string[] = [];
  L.push('; ChopiLaser - G-code para GRBL por tarjeta SD');
  L.push(`; S maximo ($30): ${milesimasCortas(sMaxMilesimas(cfg.sMax))}`);
  L.push(
    `; Area de trabajo: X ${milesimasFijas(lim.x.min)} a ${milesimasFijas(lim.x.max)}, ` +
      `Y ${milesimasFijas(lim.y.min)} a ${milesimasFijas(lim.y.max)} mm`,
  );
  L.push('G21 G90');
  L.push('M5 S0');

  trabajo.capas.forEach((tc, i) => {
    validarCapa(tc.capa, i);
    const { capa } = tc;
    const s = potenciaAS(capa.potencia, cfg.sMax);
    const f = milesimasCortas(aMilesimas(capa.velocidad));
    L.push(
      `; Capa ${i + 1}: potencia ${milesimasCortas(aMilesimas(Math.min(100, Math.max(0, capa.potencia))))}%, ` +
        `velocidad ${f} mm/min, pasadas ${capa.pasadas}, modo ${capa.modo}`,
    );
    for (let p = 0; p < capa.pasadas; p++) {
      for (const tray of tc.trayectorias) {
        if (tray.length < 2) continue;
        const pts = tray.map((pt) => ({
          x: coordenada(pt.x, lim.x, 'X'),
          y: coordenada(pt.y, lim.y, 'Y'),
        }));
        L.push('S0');
        L.push(`G0 ${pts[0].x} ${pts[0].y}`);
        L.push(`${capa.modo} S${s}`);
        L.push(`G1 ${pts[1].x} ${pts[1].y} F${f}`);
        for (let j = 2; j < pts.length; j++) L.push(`G1 ${pts[j].x} ${pts[j].y}`);
      }
    }
  });

  L.push('M5');
  L.push('S0');
  const texto = L.join('\n') + '\n';
  if (!SOLO_ASCII.test(texto)) throw new ErrorGcode('El G-code generado contiene caracteres no ASCII.');
  return texto;
}

/** Bytes exactos del archivo: ASCII, sin BOM, LF. Las dos rutas de exportación usan esto. */
export function gcodeABytes(texto: string): Uint8Array {
  if (!SOLO_ASCII.test(texto)) throw new ErrorGcode('El G-code contiene caracteres no ASCII.');
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i);
  return bytes;
}
