// Formato numérico determinista. Se trabaja en milésimas enteras para evitar
// las sorpresas de toFixed() con decimales binarios.

/** Redondea a milésimas enteras (mitad hacia arriba). */
export function aMilesimas(n: number): number {
  return Math.round(n * 1000);
}

/** Milésimas enteras ≥ 0 a texto con exactamente 3 decimales: 12345 -> "12.345". */
export function milesimasFijas(k: number): string {
  const ent = Math.floor(k / 1000);
  const frac = String(k - ent * 1000).padStart(3, '0');
  return `${ent}.${frac}`;
}

/** Milésimas enteras ≥ 0 a texto sin ceros sobrantes: 127500 -> "127.5", 1000000 -> "1000". */
export function milesimasCortas(k: number): string {
  const ent = Math.floor(k / 1000);
  const resto = k - ent * 1000;
  if (resto === 0) return String(ent);
  return `${ent}.${String(resto).padStart(3, '0').replace(/0+$/, '')}`;
}
