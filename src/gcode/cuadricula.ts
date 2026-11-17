// Cuadrícula de prueba de potencia × velocidad para calibrar materiales.
// Columnas: potencias. Filas: velocidades, primero en M3 y luego en M4.
// Incluye a propósito celdas al 0 % y al 100 % para ejercitar los extremos de S.
import { ErrorGcode, type AreaTrabajo, type ModoLaser, type Polilinea, type Trabajo } from './types';

/** Tamaño disponible de un área de trabajo. */
export function tamanoArea(a: AreaTrabajo): { ancho: number; alto: number } {
  return { ancho: a.xMax - a.xMin, alto: a.yMax - a.yMin };
}

export interface OpcionesCuadricula {
  potencias: number[];
  velocidades: number[];
  modos: ModoLaser[];
  /** Lado de cada cuadro en mm. */
  lado: number;
  /** Separación entre cuadros en mm. */
  separacion: number;
  /** Margen desde el origen (0,0) en mm. */
  margen: number;
  /** Distancia entre líneas de relleno en mm. */
  paso: number;
}

export const CUADRICULA_PREDETERMINADA: OpcionesCuadricula = {
  potencias: [0, 25, 50, 75, 100],
  velocidades: [600, 1200, 2400],
  modos: ['M3', 'M4'],
  lado: 10,
  separacion: 4,
  margen: 5,
  paso: 1,
};

export function tamanoCuadricula(o: OpcionesCuadricula): { ancho: number; alto: number } {
  const filas = o.velocidades.length * o.modos.length;
  const cols = o.potencias.length;
  return {
    ancho: 2 * o.margen + cols * o.lado + (cols - 1) * o.separacion,
    alto: 2 * o.margen + filas * o.lado + (filas - 1) * o.separacion,
  };
}

function cuadro(x0: number, y0: number, lado: number, paso: number): Polilinea[] {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const x1 = r(x0 + lado);
  const y1 = r(y0 + lado);
  const contorno: Polilinea = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
  const relleno: Polilinea[] = [];
  const n = Math.floor(lado / paso + 1e-9);
  for (let i = 1; i < n; i++) {
    const y = r(y0 + i * paso);
    // Zigzag: alterna el sentido para reducir movimientos en vacío.
    relleno.push(i % 2 === 1 ? [{ x: x0, y }, { x: x1, y }] : [{ x: x1, y }, { x: x0, y }]);
  }
  return [contorno, ...relleno];
}

/** Cuadrícula en coordenadas del diseño (0,0 abajo a la izquierda); el generador la traslada al área. */
export function generarCuadricula(
  cama: { ancho: number; alto: number },
  o: OpcionesCuadricula = CUADRICULA_PREDETERMINADA,
): Trabajo {
  const t = tamanoCuadricula(o);
  if (t.ancho > cama.ancho || t.alto > cama.alto) {
    throw new ErrorGcode(
      `La cuadrícula mide ${t.ancho} x ${t.alto} mm y no cabe en el área de trabajo de ${cama.ancho} x ${cama.alto} mm.`,
    );
  }
  const capas: Trabajo['capas'] = [];
  let fila = 0;
  for (const modo of o.modos) {
    for (const velocidad of o.velocidades) {
      const y0 = o.margen + fila * (o.lado + o.separacion);
      o.potencias.forEach((potencia, col) => {
        const x0 = o.margen + col * (o.lado + o.separacion);
        capas.push({
          capa: { potencia, velocidad, pasadas: 1, modo },
          trayectorias: cuadro(x0, y0, o.lado, o.paso),
        });
      });
      fila++;
    }
  }
  return { capas };
}
