#!/bin/sh
# Regenera las woff2 de Rajdhani (500, 600, 700; subconjunto latino) desde los TTF
# oficiales de google/fonts (ofl/rajdhani), recalculando los bbox de los glifos
# (Firefox avisaba «glyf: Glyph bbox was incorrect» con las de Fontsource).
# Requiere: python3 con fonttools y brotli.  Uso: sh tools/generar_fuentes.sh
set -eu
DIR=$(dirname "$0")/../src/fuentes
TMP=$(mktemp -d)
RANGO='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
for par in 500:Medium 600:SemiBold 700:Bold; do
  peso=${par%%:*}; nombre=${par#*:}
  curl -sfL "https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/Rajdhani-$nombre.ttf" -o "$TMP/$nombre.ttf"
  python3 -m fontTools.subset "$TMP/$nombre.ttf" \
    --unicodes="$RANGO" --layout-features='*' --recalc-bounds --recalc-max-context \
    --no-hinting --desubroutinize --flavor=woff2 \
    --output-file="$DIR/rajdhani-latin-$peso-normal.woff2"
done
rm -rf "$TMP"
