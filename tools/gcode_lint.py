#!/usr/bin/env python3
"""Validador de seguridad de G-code para láser GRBL (independiente del generador).

Reglas (error = exit 1):
  G0_LASER_ON   movimiento G0 con láser encendido (M3/M4 y S>0)
  S_OVER_MAX    algún S mayor que --max-s (valor de $30)
  NO_M5_END     el archivo no termina con el láser apagado por M5
  NO_FEED       G1/G2/G3 con láser encendido sin F definido antes
  OUT_OF_BED    coordenada fuera de 0..--bed X,Y (opcional)
  PARSE         palabra que no se puede leer
Avisos: M3/M4 sin S previo, comandos no reconocidos.
--laser-mode ($32=1): G0 con láser encendido pasa de error a aviso.
"""
import argparse, json, re, sys

WORD = re.compile(r'([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))')

def strip(line):
    line = re.sub(r'\([^)]*\)', '', line)
    return line.split(';', 1)[0].strip()

def lint(text, max_s, laser_mode=False, bed=None):
    errs, warns = [], []
    st = dict(motion=None, spindle='M5', s=0.0, f=None, rel=False, x=0.0, y=0.0, s_seen=False)
    for n, raw in enumerate(text.splitlines(), 1):
        line = strip(raw)
        if not line or line.startswith('%') or line.startswith('$'):
            continue
        rest = WORD.sub('', line).strip()
        if rest:
            errs.append((n, 'PARSE', f'no se entiende «{rest}» en «{raw.strip()}»'))
        words = [(l.upper(), float(v)) for l, v in WORD.findall(line)]
        axes = {}
        for l, v in words:
            if l == 'G':
                g = int(v) if v == int(v) else v
                if g in (0, 1, 2, 3): st['motion'] = g
                elif g == 90: st['rel'] = False
                elif g == 91: st['rel'] = True
            elif l == 'M':
                m = int(v)
                if m in (3, 4):
                    st['spindle'] = f'M{m}'
                    if not st['s_seen'] and not any(w == 'S' for w, _ in words):
                        warns.append((n, 'M_SIN_S', 'M3/M4 sin S definido'))
                elif m in (5, 2, 30):
                    st['spindle'] = 'M5'
                elif m not in (0, 1, 6, 7, 8, 9):
                    warns.append((n, 'M_DESCONOCIDO', f'M{m}'))
            elif l == 'S':
                st['s'] = v; st['s_seen'] = True
                if v > max_s:
                    errs.append((n, 'S_OVER_MAX', f'S{v:g} > $30={max_s:g}'))
            elif l == 'F':
                st['f'] = v
            elif l in 'XYZIJ':
                axes[l] = v
        moving = any(a in axes for a in 'XYZ')
        on = st['spindle'] in ('M3', 'M4') and st['s'] > 0
        if moving and st['motion'] == 0 and on:
            (warns if laser_mode else errs).append((n, 'G0_LASER_ON', f'G0 con {st["spindle"]} S{st["s"]:g}'))
        if moving and st['motion'] in (1, 2, 3) and on and st['f'] is None:
            errs.append((n, 'NO_FEED', 'corte sin F definido'))
        for a in 'XY':
            if a in axes:
                st[a.lower()] = st[a.lower()] + axes[a] if st['rel'] else axes[a]
        if bed and moving:
            x0, y0, x1, y1 = bed if len(bed) == 4 else (0, 0, bed[0], bed[1])
            if not (x0 <= st['x'] <= x1 and y0 <= st['y'] <= y1):
                errs.append((n, 'OUT_OF_BED', f'X{st["x"]:g} Y{st["y"]:g} fuera de X{x0:g}..{x1:g} Y{y0:g}..{y1:g}'))
    if st['spindle'] != 'M5':
        errs.append((0, 'NO_M5_END', f'termina con {st["spindle"]}'))
    return errs, warns

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('files', nargs='+')
    p.add_argument('--max-s', type=float, required=True, help='valor de $30 de la máquina')
    p.add_argument('--laser-mode', action='store_true', help='$32=1')
    p.add_argument('--bed', help='ancho,alto en mm (área 0..ancho, 0..alto)')
    p.add_argument('--area', help='xmin,ymin,xmax,ymax en mm, para orígenes de homing con coordenadas negativas')
    p.add_argument('--json', action='store_true')
    a = p.parse_args(argv)
    if a.bed and a.area: p.error('usa --bed o --area, no los dos')
    bed = tuple(float(x) for x in (a.area or a.bed).split(',')) if (a.area or a.bed) else None
    if bed and len(bed) not in (2, 4): p.error('--bed lleva 2 números y --area 4')
    rc, out = 0, {}
    for f in a.files:
        e, w = lint(open(f, encoding='utf-8', errors='replace').read(), a.max_s, a.laser_mode, bed)
        out[f] = dict(errores=e, avisos=w)
        if e: rc = 1
        if not a.json:
            print(f'{"FAIL" if e else "OK  "} {f}: {len(e)} errores, {len(w)} avisos')
            for n, c, m in e: print(f'  ERROR {f}:{n} {c} {m}')
            for n, c, m in w: print(f'  aviso {f}:{n} {c} {m}')
    if a.json: print(json.dumps(out, ensure_ascii=False, indent=1))
    return rc

if __name__ == '__main__':
    sys.exit(main())
