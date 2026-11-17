// Tipos del generador de G-code. Módulo puro: sin DOM ni E/S.

/** Punto en milímetros, origen en la esquina (0,0) de la cama. */
export interface Punto {
  x: number;
  y: number;
}

/** Polilínea en mm. Se recorre en orden; para cerrarla, repetir el primer punto al final. */
export type Polilinea = Punto[];

export type ModoLaser = 'M3' | 'M4';

export interface Capa {
  /** Potencia en % (0 a 100). Se convierte a S y se limita a sMax. */
  potencia: number;
  /** Velocidad de trabajo en mm/min (F). */
  velocidad: number;
  /** Número de pasadas (entero ≥ 1). */
  pasadas: number;
  /** M3 = potencia constante (corte), M4 = potencia dinámica (grabado). */
  modo: ModoLaser;
}

export interface ConfigMaquina {
  /** Valor de $30 (S máximo). Obligatorio, > 0. */
  sMax: number;
  /** Valor de $32 (modo láser), solo como dato. El generador apaga el láser en G0 siempre. */
  laserMode32: 0 | 1 | null;
  /** Ancho de la cama en mm (X). */
  camaAncho: number;
  /** Alto de la cama en mm (Y). */
  camaAlto: number;
}

export interface TrabajoCapa {
  capa: Capa;
  trayectorias: Polilinea[];
}

export interface Trabajo {
  capas: TrabajoCapa[];
}

export class ErrorGcode extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorGcode';
  }
}
