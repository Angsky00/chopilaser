#!/usr/bin/env bash
# Compila potracelib (potrace 1.16, GPL-2.0-or-later) + envoltura.c a WebAssembly, de forma
# reproducible: emsdk y tarball de potrace fijados, tarball comprobado con SHA-256.
#   tools/potrace/construir.sh [salida.wasm]   (por defecto src/vectorizar/potrace.wasm)
# Necesita git, curl, python3 y tar. Descarga emsdk en .cache/emsdk si no hay emcc de esa versión.
set -euo pipefail
EMSDK_VERSION=4.0.23
POTRACE_VERSION=1.16
POTRACE_URL="https://potrace.sourceforge.net/download/${POTRACE_VERSION}/potrace-${POTRACE_VERSION}.tar.gz"
POTRACE_SHA256=be8248a17dedd6ccbaab2fcc45835bb0502d062e40fbded3bc56028ce5eb7acc

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
SALIDA="${1:-$RAIZ/src/vectorizar/potrace.wasm}"
CACHE="${CHOPI_CACHE:-$RAIZ/.cache}"
mkdir -p "$CACHE"

# emsdk fijado.
if ! command -v emcc >/dev/null || ! emcc --version | head -1 | grep -q " ${EMSDK_VERSION} "; then
  if [ ! -d "$CACHE/emsdk" ]; then
    git clone -q --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk.git "$CACHE/emsdk"
  fi
  (cd "$CACHE/emsdk" && ./emsdk install "$EMSDK_VERSION" >/dev/null && ./emsdk activate "$EMSDK_VERSION" >/dev/null)
  # shellcheck disable=SC1091
  source "$CACHE/emsdk/emsdk_env.sh" >/dev/null 2>&1
fi
emcc --version | head -1

# potrace fijado y comprobado.
TAR="$CACHE/potrace-${POTRACE_VERSION}.tar.gz"
[ -f "$TAR" ] || curl -fsSL -o "$TAR" "$POTRACE_URL"
echo "${POTRACE_SHA256}  $TAR" | sha256sum -c -
TRABAJO="$(mktemp -d)"
trap 'rm -rf "$TRABAJO"' EXIT
tar -xzf "$TAR" -C "$TRABAJO"
SRC="$TRABAJO/potrace-${POTRACE_VERSION}/src"
cp "$AQUI/envoltura.c" "$SRC/chopi_envoltura.c"

# Rutas fijas dentro de la compilación (sin la carpeta temporal) para que el .wasm no dependa de ella.
cd "$SRC"
emcc -O2 -g0 -ffile-prefix-map="$SRC"=/potrace -fdebug-prefix-map="$SRC"=/potrace \
  -DVERSION="\"${POTRACE_VERSION}\"" -DHAVE_INTTYPES_H=1 -I. \
  potracelib.c curve.c trace.c decompose.c chopi_envoltura.c \
  --no-entry -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16MB -sMAXIMUM_MEMORY=1GB \
  -sFILESYSTEM=0 -sASSERTIONS=0 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
  -sEXPORTED_FUNCTIONS=_chopi_trazar,_chopi_salida,_chopi_reservar,_chopi_liberar \
  -o "$TRABAJO/potrace.wasm"
mkdir -p "$(dirname "$SALIDA")"
cp "$TRABAJO/potrace.wasm" "$SALIDA"
sha256sum "$SALIDA"
