import type { Trazo } from '../diseno/geometria';

/** Lo que sale de un importador: trazos en mm, coordenadas del diseño (Y hacia arriba), una por elemento del archivo. */
export interface FiguraImportada {
  /** Color del trazo, '#rrggbb'. Define la capa. */
  color: string;
  trazos: Trazo[];
}

export interface ResultadoImportacion {
  figuras: FiguraImportada[];
  /** Elementos que no se importaron (p. ej. «textos»). */
  avisos: string[];
}
