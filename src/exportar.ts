// Exportación del .gcode. Las dos rutas escriben exactamente los mismos bytes.
//  - Chrome/Edge: showSaveFilePicker (permite elegir la tarjeta SD directamente).
//  - Firefox u otros: Blob + <a download>.
import { gcodeABytes } from './gcode/generador';

interface ManejadorArchivo {
  createWritable(): Promise<{ write(datos: Blob): Promise<void>; close(): Promise<void> }>;
}
type SelectorGuardar = (opciones: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<ManejadorArchivo>;

export type RutaExportacion = 'selector' | 'descarga' | 'cancelada';

export function crearBlob(texto: string): Blob {
  const bytes = gcodeABytes(texto);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'text/plain' });
}

export async function exportarGcode(texto: string, nombre: string): Promise<RutaExportacion> {
  const blob = crearBlob(texto);
  const selector = (window as unknown as { showSaveFilePicker?: SelectorGuardar }).showSaveFilePicker;
  if (typeof selector === 'function') {
    let manejador: ManejadorArchivo;
    try {
      manejador = await selector.call(window, {
        suggestedName: nombre,
        types: [{ description: 'G-code', accept: { 'text/plain': ['.gcode'] } }],
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelada';
      throw e;
    }
    const w = await manejador.createWritable();
    await w.write(blob);
    await w.close();
    return 'selector';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'descarga';
}
