import { describe, expect, it } from 'vitest';
import {
  figuraDesdeTrazos,
  figuraFuera,
  figurasDesdeImportacion,
  sincronizarCapas,
  TEXTOS_CAPA,
  TEXTOS_EXPORTAR,
  trabajoDesdeProyecto,
  validarCapa,
  type CapaProyecto,
  type Figura,
  type Proyecto,
} from '../../src/diseno/proyecto';
import type { Trazo } from '../../src/diseno/geometria';

const cuadro = (x0: number, y0: number, l: number): Trazo => ({
  cerrado: true,
  puntos: [{ x: x0, y: y0 }, { x: x0 + l, y: y0 }, { x: x0 + l, y: y0 + l }, { x: x0, y: y0 + l }, { x: x0, y: y0 }],
});
const capa = (color: string, c: Partial<CapaProyecto> = {}): CapaProyecto => ({
  color,
  modo: 'corte',
  potencia: '50',
  velocidad: '600',
  pasadas: '1',
  intervalo: '',
  visible: true,
  salida: true,
  ...c,
});
const AREA = { ancho: 100, alto: 100 };

describe('validarCapa', () => {
  it('acepta una capa completa y da números', () => {
    const r = validarCapa(capa('#f00', { potencia: '12.5', velocidad: '1500', pasadas: '3' }));
    expect(r).toEqual({ ok: true, capa: { potencia: 12.5, velocidad: 1500, pasadas: 3, intervalo: 0 } });
  });
  it('rechaza cada campo fuera de rango con su texto', () => {
    const r = validarCapa(capa('#f00', { potencia: '101', velocidad: '0', pasadas: '1.5' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porCampo).toEqual({ potencia: TEXTOS_CAPA.potencia, velocidad: TEXTOS_CAPA.velocidad, pasadas: TEXTOS_CAPA.pasadas });
  });
  it('vacío no es válido (no hay valores por defecto inventados)', () => {
    expect(validarCapa(capa('#f00', { potencia: '', velocidad: '', pasadas: '' })).ok).toBe(false);
  });
  it('el intervalo solo cuenta en grabado', () => {
    expect(validarCapa(capa('#f00', { intervalo: 'x' })).ok).toBe(true);
    const g = validarCapa(capa('#f00', { modo: 'grabado', intervalo: '0' }));
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.porCampo.intervalo).toBe(TEXTOS_CAPA.intervalo);
    expect(validarCapa(capa('#f00', { modo: 'grabado', intervalo: '0.1' })).ok).toBe(true);
  });
});

describe('figuras y capas', () => {
  it('importación que cabe se queda en su sitio; si no cabe, se lleva a (0,0)', () => {
    const imp = (x: number) => ({ figuras: [{ color: '#ff0000', trazos: [cuadro(x, 10, 10)] }], avisos: [] });
    expect(figurasDesdeImportacion(imp(20), AREA)[0].x).toBe(25);
    const lejos = figurasDesdeImportacion(imp(-40), AREA)[0];
    expect([lejos.x, lejos.y]).toEqual([5, 5]);
  });
  it('sincronizarCapas conserva las capas existentes, quita las vacías y crea las nuevas', () => {
    const f = [figuraDesdeTrazos('#f00', [cuadro(0, 0, 1)]), figuraDesdeTrazos('#00f', [cuadro(0, 0, 1)])];
    const vieja = capa('#f00', { potencia: '77' });
    const r = sincronizarCapas(f, [capa('#0f0'), vieja], (c) => capa(c, { potencia: '' }));
    expect(r.map((c) => c.color)).toEqual(['#f00', '#00f']);
    expect(r[0]).toBe(vieja);
    expect(r[1].potencia).toBe('');
  });
  it('figuraFuera mira el área tras redondear a milésimas', () => {
    expect(figuraFuera(figuraDesdeTrazos('#f00', [cuadro(90, 90, 10)]), AREA)).toBe(false);
    expect(figuraFuera(figuraDesdeTrazos('#f00', [cuadro(90.0004, 0, 10)]), AREA)).toBe(false);
    expect(figuraFuera(figuraDesdeTrazos('#f00', [cuadro(90.001, 0, 10)]), AREA)).toBe(true);
    expect(figuraFuera(figuraDesdeTrazos('#f00', [cuadro(-0.001, 0, 10)]), AREA)).toBe(true);
  });
});

describe('trabajoDesdeProyecto', () => {
  const rojo = figuraDesdeTrazos('#f00', [cuadro(10, 10, 40), cuadro(20, 20, 5)], 'r');
  const negro = figuraDesdeTrazos('#000', [cuadro(60, 60, 10)], 'n');
  const base = (c: Partial<Proyecto> = {}): Proyecto => ({
    material: 'Prueba',
    figuras: [rojo, negro],
    capas: [capa('#f00'), capa('#000', { modo: 'grabado', potencia: '30', intervalo: '1' })],
    ...c,
  });

  it('grabado (M4) antes que corte (M3); dentro del corte, el trazo pequeño primero', () => {
    const r = trabajoDesdeProyecto(base(), AREA);
    if (!r.ok) throw new Error(r.error);
    expect(r.trabajo.capas.map((c) => c.capa.modo)).toEqual(['M4', 'M3']);
    expect(r.trabajo.capas[0].trayectorias).toHaveLength(10);
    const corte = r.trabajo.capas[1].trayectorias;
    expect(corte[0][0]).toEqual({ x: 20, y: 20 });
    expect(corte[1][0]).toEqual({ x: 10, y: 10 });
  });

  it('sin capas con salida no hay nada que exportar', () => {
    const r = trabajoDesdeProyecto(base({ capas: [capa('#f00', { salida: false }), capa('#000', { visible: false })] }), AREA);
    expect(r).toEqual({ ok: false, error: TEXTOS_EXPORTAR.sinFiguras, fuera: [] });
    expect(trabajoDesdeProyecto(base({ figuras: [] }), AREA).ok).toBe(false);
  });

  it('una figura fuera del área bloquea la exportación y se señala', () => {
    const fuera: Figura = { ...negro, x: 99 };
    const r = trabajoDesdeProyecto(base({ figuras: [rojo, fuera] }), AREA);
    expect(r).toEqual({ ok: false, error: TEXTOS_EXPORTAR.fuera(1), fuera: ['n'] });
  });

  it('una figura fuera en una capa sin salida no bloquea', () => {
    const fuera: Figura = { ...negro, x: 99 };
    const r = trabajoDesdeProyecto(base({ figuras: [rojo, fuera], capas: [capa('#f00'), capa('#000', { salida: false })] }), AREA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trabajo.capas).toHaveLength(1);
  });

  it('una capa incompleta bloquea con su número (desde 1)', () => {
    const r = trabajoDesdeProyecto(base({ capas: [capa('#f00'), capa('#000', { potencia: '' })] }), AREA);
    expect(r).toEqual({ ok: false, error: TEXTOS_EXPORTAR.capaIncompleta(2), fuera: [] });
  });

  it('los trazos abiertos no se rellenan en grabado', () => {
    const linea = figuraDesdeTrazos('#000', [{ cerrado: false, puntos: [{ x: 1, y: 1 }, { x: 9, y: 9 }] }]);
    const r = trabajoDesdeProyecto({ material: '', figuras: [linea], capas: [capa('#000', { modo: 'grabado', intervalo: '1' })] }, AREA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trabajo.capas[0].trayectorias).toEqual([]);
  });

  it('el giro de la figura se aplica a las coordenadas que van al generador', () => {
    const g: Figura = { ...rojo, angulo: 90 };
    const r = trabajoDesdeProyecto(base({ figuras: [g], capas: [capa('#f00')] }), AREA);
    if (!r.ok) throw new Error(r.error);
    const p = r.trabajo.capas[0].trayectorias[1][0];
    expect(p.x).toBeCloseTo(50, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });
});

describe('potencia de la capa: de 1 a 100', () => {
  it('rechaza 0 y 101 con el texto de Marketing; acepta 1 y 100', () => {
    expect(TEXTOS_CAPA.potencia).toBe('Potencia: escribe un número de 1 a 100.');
    for (const v of ['0', '0.5', '101', '100.5']) {
      const r = validarCapa(capa('#f00', { potencia: v }));
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.porCampo.potencia).toBe(TEXTOS_CAPA.potencia);
    }
    for (const v of ['1', '100', '55.5']) expect(validarCapa(capa('#f00', { potencia: v })).ok, v).toBe(true);
  });
});

describe('B1: orden global de corte (lo de dentro antes que su contorno)', () => {
  const primeros = (r: ReturnType<typeof trabajoDesdeProyecto>) => {
    if (!r.ok) throw new Error(r.error);
    return r.trabajo.capas.flatMap((c) => c.trayectorias.map((t) => ({ p: t[0], potencia: c.capa.potencia, modo: c.capa.modo })));
  };

  it('agujero como figura aparte de la misma capa: el primer corte empieza en el agujero (20,20)', () => {
    const contorno = figuraDesdeTrazos('#f00', [cuadro(10, 10, 40)], 'contorno');
    const agujero = figuraDesdeTrazos('#f00', [cuadro(20, 20, 5)], 'agujero');
    const r = trabajoDesdeProyecto({ material: '', figuras: [contorno, agujero], capas: [capa('#f00')] }, AREA);
    expect(primeros(r).map((x) => x.p)).toEqual([{ x: 20, y: 20 }, { x: 10, y: 10 }]);
  });

  it('agujero en otra capa de corte (aunque esa capa vaya después): se corta antes, con sus propios ajustes', () => {
    const contorno = figuraDesdeTrazos('#f00', [cuadro(10, 10, 40)], 'contorno');
    const agujero = figuraDesdeTrazos('#00f', [cuadro(20, 20, 5)], 'agujero');
    const r = trabajoDesdeProyecto(
      { material: '', figuras: [contorno, agujero], capas: [capa('#f00', { potencia: '90' }), capa('#00f', { potencia: '20', pasadas: '3' })] },
      AREA,
    );
    expect(primeros(r)).toEqual([
      { p: { x: 20, y: 20 }, potencia: 20, modo: 'M3' },
      { p: { x: 10, y: 10 }, potencia: 90, modo: 'M3' },
    ]);
    if (r.ok) expect(r.trabajo.capas.map((c) => c.capa.pasadas)).toEqual([3, 1]);
  });

  it('tres niveles anidados en figuras distintas: de lo más hondo hacia fuera', () => {
    const fuera = figuraDesdeTrazos('#f00', [cuadro(0, 0, 90)], 'a');
    const medio = figuraDesdeTrazos('#f00', [cuadro(10, 10, 70)], 'b');
    const dentro = figuraDesdeTrazos('#f00', [cuadro(30, 30, 20)], 'c');
    const suelto = figuraDesdeTrazos('#f00', [cuadro(92, 92, 5)], 'd'); // fuera de todo, pequeño
    const r = trabajoDesdeProyecto({ material: '', figuras: [fuera, medio, suelto, dentro], capas: [capa('#f00')] }, AREA);
    const orden = primeros(r).map((x) => `${x.p.x},${x.p.y}`);
    expect(orden.indexOf('30,30')).toBeLessThan(orden.indexOf('10,10'));
    expect(orden.indexOf('10,10')).toBeLessThan(orden.indexOf('0,0'));
    expect(orden[orden.length - 1]).toBe('0,0');
    expect(orden).toHaveLength(4);
  });

  it('un trazo abierto dentro de un contorno se corta antes que el contorno', () => {
    const contorno = figuraDesdeTrazos('#f00', [cuadro(10, 10, 40)], 'contorno');
    const raya = figuraDesdeTrazos('#00f', [{ cerrado: false, puntos: [{ x: 20, y: 30 }, { x: 40, y: 30 }] }], 'raya');
    const r = trabajoDesdeProyecto({ material: '', figuras: [contorno, raya], capas: [capa('#f00'), capa('#00f')] }, AREA);
    expect(primeros(r).map((x) => x.p)).toEqual([{ x: 20, y: 30 }, { x: 10, y: 10 }]);
  });

  it('el grabado sigue yendo antes que todo el corte', () => {
    const contorno = figuraDesdeTrazos('#f00', [cuadro(10, 10, 40)], 'contorno');
    const relleno = figuraDesdeTrazos('#000', [cuadro(20, 20, 5)], 'relleno');
    const r = trabajoDesdeProyecto(
      { material: '', figuras: [contorno, relleno], capas: [capa('#f00'), capa('#000', { modo: 'grabado', intervalo: '1' })] },
      AREA,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.trabajo.capas.map((c) => c.capa.modo)).toEqual(['M4', 'M3']);
  });

  it('una capa con la salida apagada no aparece en el trabajo', () => {
    const a = figuraDesdeTrazos('#f00', [cuadro(10, 10, 40)], 'a');
    const b = figuraDesdeTrazos('#00f', [cuadro(20, 20, 5)], 'b');
    const r = trabajoDesdeProyecto({ material: '', figuras: [a, b], capas: [capa('#f00', { potencia: '90' }), capa('#00f', { potencia: '20', salida: false })] }, AREA);
    if (!r.ok) throw new Error(r.error);
    expect(r.trabajo.capas.map((c) => c.capa.potencia)).toEqual([90]);
    expect(r.trabajo.capas.flatMap((c) => c.trayectorias)).toHaveLength(1);
  });
});

describe('trazos abiertos', () => {
  const u = (color: string) =>
    figuraDesdeTrazos(color, [{ cerrado: false, puntos: [{ x: 10, y: 50 }, { x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }] }], 'u');

  it('en grabado no se rellenan, ni siquiera una «U» de varios puntos, y se avisa (singular)', () => {
    const r = trabajoDesdeProyecto({ material: '', figuras: [u('#000')], capas: [capa('#000', { modo: 'grabado', intervalo: '1' })] }, AREA);
    if (!r.ok) throw new Error(r.error);
    expect(r.trabajo.capas[0].trayectorias).toEqual([]);
    expect(r.avisos).toEqual(['El relleno no incluye 1 trazo abierto de la capa 1. Ciérralos o pásalos a una capa de corte.']);
  });

  it('el aviso cuenta los trazos abiertos (plural) y da el número de la capa', () => {
    const dos = figuraDesdeTrazos('#000', [
      { cerrado: false, puntos: [{ x: 1, y: 1 }, { x: 9, y: 9 }] },
      { cerrado: false, puntos: [{ x: 11, y: 1 }, { x: 19, y: 9 }, { x: 30, y: 1 }] },
      cuadro(40, 40, 10),
    ]);
    const r = trabajoDesdeProyecto(
      { material: '', figuras: [figuraDesdeTrazos('#f00', [cuadro(60, 60, 5)]), dos], capas: [capa('#f00'), capa('#000', { modo: 'grabado', intervalo: '1' })] },
      AREA,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.avisos).toEqual(['El relleno no incluye 2 trazos abiertos de la capa 2. Ciérralos o pásalos a una capa de corte.']);
    expect(TEXTOS_EXPORTAR.abiertosEnGrabado(1, 3)).toBe('El relleno no incluye 1 trazo abierto de la capa 3. Ciérralos o pásalos a una capa de corte.');
  });

  it('en corte se cortan como líneas, sin aviso', () => {
    const r = trabajoDesdeProyecto({ material: '', figuras: [u('#f00')], capas: [capa('#f00')] }, AREA);
    if (!r.ok) throw new Error(r.error);
    expect(r.avisos).toEqual([]);
    expect(r.trabajo.capas[0].trayectorias).toEqual([[{ x: 10, y: 50 }, { x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }]]);
  });
});
