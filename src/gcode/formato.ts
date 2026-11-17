// Formato numérico determinista. Se trabaja en milésimas enteras para evitar
// las sorpresas de toFixed() con decimales binarios.

/** Redondea a milésimas enteras (mitad hacia arriba). Nunca devuelve -0. */
export function aMilesimas(n: number): number {
  const k = Math.round(n * 1000);
  return k === 0 ? 0 : k;
}

function partes(k: number): { signo: string; ent: number; frac: number } {
  const a = Math.abs(k);
  const ent = Math.floor(a / 1000);
  return { signo: k < 0 ? '-' : '', ent, frac: a - ent * 1000 };
}

/** Milésimas enteras a texto con exactamente 3 decimales: 12345 -> "12.345", -500 -> "-0.500". */
export function milesimasFijas(k: number): string {
  const { signo, ent, frac } = partes(k);
  return `${signo}${ent}.${String(frac).padStart(3, '0')}`;
}

/** Milésimas enteras a texto sin ceros sobrantes: 127500 -> "127.5", 1000000 -> "1000", 500 -> "0.5". */
export function milesimasCortas(k: number): string {
  const { signo, ent, frac } = partes(k);
  if (frac === 0) return `${signo}${ent}`;
  return `${signo}${ent}.${String(frac).padStart(3, '0').replace(/0+$/, '')}`;
}
