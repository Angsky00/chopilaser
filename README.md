# ChopiLaser

ChopiLaser, nombre provisional.

Aplicación web para generar G-code de grabado y corte láser y guardarlo en la tarjeta SD de una
máquina con GRBL, pensada para la **MKS DLC32 (GRBL_ESP32)** usada solo por SD: no se conecta
por USB ni controla la máquina.

## Dónde funciona

Es una página web estática: se abre en el navegador y no hay que instalar nada.

- **Windows:** Chrome, Edge o Firefox.
- **Linux (por ejemplo CachyOS):** Chromium, Chrome o Firefox.

Al exportar, Chrome y Edge abren el diálogo «Guardar como» y se puede elegir la tarjeta SD
directamente. Firefox no tiene esa función, así que descarga el archivo `.gcode` y luego se copia a
la SD. En los dos casos el archivo es idéntico, byte por byte.

## Fase 0 (estado actual)

- **Configuración de la máquina**, guardada en el navegador (localStorage):
  - «S máximo ($30)», obligatorio.
  - Ancho y alto de la cama en mm, obligatorios.
  - Modo láser ($32), solo como dato.
  - No hay valores por defecto: si algún campo obligatorio está vacío, es 0, negativo o no es un
    número, no se puede generar ni exportar.
- **Cuadrícula de prueba** de potencia × velocidad, en M3 y en M4, con celdas al 0 % y al 100 %,
  para calibrar materiales.
- **Exportar `.gcode`.**

### Garantías de seguridad del G-code

El generador (`src/gcode/`) es un módulo puro, sin interfaz, y garantiza:

- Cabecera `G21 G90` (milímetros, coordenadas absolutas).
- `S0` antes de cada `G0`, aunque `$32` sea 0: nunca hay un movimiento rápido con el láser encendido.
- `F` antes del primer `G1`.
- `S` calculado desde el % y limitado a `$30`: 100 % es exactamente `$30` y 0 % es `S0`.
- Siempre termina con `M5` y `S0`.
- Coordenadas con 3 decimales fijos, sin `NaN`, sin negativos y dentro de la cama.
- Archivo solo ASCII, sin BOM y con fin de línea LF.

Además, el validador independiente de QA `tools/gcode_lint.py` revisa en el CI todos los archivos
de referencia, sin `--laser-mode`.

## Desarrollo

Requiere Node 22 y Python 3 con pytest.

```bash
npm ci
npm run dev          # servidor de desarrollo
npm run build        # compila a dist/
```

## Pruebas

```bash
npx vitest run                         # generador, configuración, goldens y trabajos aleatorios
python3 -m pytest -q tools/tests       # pruebas del validador de QA
npx playwright install chromium firefox
npx playwright test --project=chromium --project=firefox   # interfaz y exportación
```

- `tests/golden/` guarda los archivos de referencia de la cuadrícula. `tests/golden/configs.json`
  tiene las configuraciones con que se generan (sMax 1000 y 255, cama 400 x 400 mm). **Son valores
  de prueba, no los de la máquina real.** Para regenerarlos: `npm run golden` (revisa el diff).
- Playwright exporta la cuadrícula en cada navegador y comprueba que el SHA-256 del archivo es igual
  al del golden y que pasa el validador. En Chromium también prueba la ruta de descarga quitando
  `showSaveFilePicker`.
- El proyecto `msedge` de Playwright solo corre en Windows (CI en `windows-latest`).

Validador a mano:

```bash
python3 tools/gcode_lint.py --max-s 1000 --bed 400,400 tests/golden/cuadricula_s1000.gcode
```

`tools/gcode_lint.py` y `tools/tests/test_lint.py` son copia exacta de la versión de QA. Cualquier
cambio lo hace QA, no el generador.

## Licencia

GPLv3 o posterior (`GPL-3.0-or-later`). Ver `LICENSE`.

ChopiLaser se escribió desde cero: no contiene código, recursos ni formatos de LightBurn ni de
LaserGRBL.
