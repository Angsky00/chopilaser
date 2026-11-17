// Web Worker del vectorizado: el trazado (potrace) no bloquea la interfaz.
import { svgTrazado, trazarImagen, type OpcionesTrazado, type ResultadoTrazado } from './trazar';

export interface PedidoTrazado {
  id: number;
  /** La imagen se manda una sola vez por imagenId; luego solo cambian las opciones. */
  imagenId: number;
  rgba?: Uint8ClampedArray;
  ancho: number;
  alto: number;
  dpi: number | null;
  opciones: OpcionesTrazado;
}

export type RespuestaTrazado =
  | { id: number; ok: true; resultado: Omit<ResultadoTrazado, 'trayectos'>; svg: string }
  | { id: number; ok: false; error: string };

const ambito = self as unknown as { onmessage: ((e: MessageEvent<PedidoTrazado>) => void) | null; postMessage(m: RespuestaTrazado): void };

let guardada: { imagenId: number; rgba: Uint8ClampedArray } | null = null;

ambito.onmessage = async (e) => {
  const { id, imagenId, ancho, alto, dpi, opciones } = e.data;
  if (e.data.rgba) guardada = { imagenId, rgba: e.data.rgba };
  if (!guardada || guardada.imagenId !== imagenId) {
    ambito.postMessage({ id, ok: false, error: 'falta la imagen' });
    return;
  }
  const rgba = guardada.rgba;
  try {
    const r = await trazarImagen(rgba, ancho, alto, opciones, dpi);
    const { trayectos, ...resto } = r;
    ambito.postMessage({ id, ok: true, resultado: resto, svg: svgTrazado({ trayectos }, ancho, alto) });
  } catch (err) {
    ambito.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
