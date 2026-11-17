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

- **Configuración inicial:** la primera vez que se abre la app, antes que nada, aparece la pantalla
  de configuración de la máquina. Pide:
  - el nombre del perfil;
  - «S máximo ($30)» y el modo láser ($32, solo como dato);
  - el área de trabajo: ancho, alto y esquina del origen (0,0), o xmin, ymin, xmax, ymax.

  Tiene un botón con los valores de fábrica de GRBL 1.1 y una caja «Pegar salida de $$» que lee
  $30, $32, $130 y $131, y también $23 (dirección del homing), que se guarda solo como dato y se
  muestra sin poder editarse. Los valores de $$ deben ser números estrictos (`^-?\d+(\.\d+)?$`):
  `1e3` o `4.0.0` se ignoran, no se recortan. Al guardar se crea el primer perfil y se abre la app. Después, los perfiles
  se editan o se crean desde el botón «Máquina». Se guardan en el navegador (localStorage).
- **Sin valores por defecto:** si el nombre, $30 o el área están vacíos, en 0, son negativos donde
  no se permite o no son números, no se puede guardar el perfil, generar ni exportar.
- **Solo punto decimal:** `12.5` vale; `1,000` o `12,5` se rechazan con «Escribe un número.», sin
  adivinar si la coma es de miles o decimal.
- **Topes** (constantes en `src/gcode/config.ts`):
  - `MAX_S = 100000`: S máximo ($30) no puede pasar de 100000.
  - `MAX_DIMENSION_MM = 5000`: el ancho y el fondo del área no pueden pasar de 5000 mm, y en el modo
    avanzado cada coordenada debe estar entre -5000 y 5000 mm.
- **Perfiles en `.json`:** en «Máquina», «Exportar perfiles» descarga `chopilaser-perfiles.json`
  (`{"formato": "chopilaser-perfiles", "version": 1, "activo": n, "perfiles": [...]}`) e «Importar
  perfiles» lo lee. La importación es estricta: si algo no vale (otro formato, otra versión, un dato
  desconocido, un valor que no es texto o un perfil no válido), se rechaza el archivo entero con un
  error visible y no cambia nada. Los perfiles importados se añaden a los que ya había.
- **Datos dañados:** si lo guardado en el navegador no se puede leer, se muestra un aviso en vez de
  descartarlo en silencio; al guardar encima se conserva una copia en `chopilaser.perfiles.v1.danado`.
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
- El diseño se traslada a la esquina (xmin, ymin) del área de trabajo, que puede ser negativa
  según el origen del homing. Las coordenadas tienen 3 decimales fijos, sin `NaN` y siempre dentro
  del área.
- S conserva 3 decimales, así que también sirve una escala de 0 a 1 (por ejemplo 50 % = `S0.5`).
- Archivo solo ASCII, sin BOM y con fin de línea LF.

Además, el validador independiente de QA `tools/gcode_lint.py` revisa en el CI todos los archivos
de referencia, sin `--laser-mode`, con `--max-s` y `--area=` de cada perfil de prueba.

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

- `tests/golden/` guarda los archivos de referencia de la cuadrícula para tres perfiles. Sus valores
  están en `tests/golden/configs.json`. **Son perfiles de prueba, no los de la máquina real:**
  - a: sMax 1000, origen abajo a la izquierda, área 0,0 a 400,400;
  - b: sMax 255, origen arriba a la derecha, área -300,-200 a 0,0;
  - c: S de 0 a 1 (tipo Smoothie), área personalizada 10,20 a 310,220.

  Para regenerarlos: `npm run golden` (revisa el diff).
- Playwright prueba la pantalla de configuración inicial y los perfiles, y exporta la cuadrícula en cada navegador y comprueba que el SHA-256 del archivo es igual
  al del golden y que pasa el validador. En Chromium también prueba la ruta de descarga quitando
  `showSaveFilePicker`.
- El proyecto `msedge` de Playwright solo corre en Windows (CI en `windows-latest`).
- Playwright levanta su propio servidor en el puerto 4173; si está ocupado, usa `PW_PUERTO=otro`.

Validador a mano (escribe `--area=` con `=` por los valores negativos):

```bash
python3 tools/gcode_lint.py --max-s 1000 --area=0,0,400,400 tests/golden/cuadricula_a_s1000.gcode
python3 tools/gcode_lint.py --max-s 255 --area=-300,-200,0,0 tests/golden/cuadricula_b_s255.gcode
python3 tools/gcode_lint.py --max-s 1 --area=10,20,310,220 tests/golden/cuadricula_c_s1.gcode
```

`tools/gcode_lint.py` y `tools/tests/test_lint.py` son copia exacta de la versión de QA. Cualquier
cambio lo hace QA, no el generador.

## Estilo visual

- Paleta y estilo de la maqueta aprobada por Angel: fondo con rejilla, paneles con esquinas
  cortadas y línea naranja a cian en el encabezado. El texto sobre naranja es oscuro (`#140c08`).
- Tipografía **Rajdhani** (SIL Open Font License 1.1), servida desde la propia app, sin CDN:
  `src/fuentes/rajdhani-latin-{500,600,700}-normal.woff2`, generadas con fontTools desde los TTF
  oficiales de google/fonts (subconjunto latino, bbox recalculados) con `sh tools/generar_fuentes.sh`. La licencia completa está en `src/fuentes/Rajdhani-OFL.txt`.
- Contraste WCAG AA: `node tools/contraste.mjs` calcula cada par texto/fondo de `src/estilo.css`
  y falla si alguno no cumple. También corre en Vitest (`tests/unit/contraste.test.ts`).
- Capturas en 1280 y 390 px, con las de la maqueta para comparar:
  `npm run build && node tools/capturas.mjs [ruta-de-la-maqueta]` (quedan en `capturas/fase-0/`).

## Licencia

GPLv3 o posterior (`GPL-3.0-or-later`). Ver `LICENSE`.

La fuente Rajdhani se distribuye bajo la SIL Open Font License 1.1 (`src/fuentes/Rajdhani-OFL.txt`).

ChopiLaser se escribió desde cero: no contiene código, recursos ni formatos de LightBurn ni de
LaserGRBL.
