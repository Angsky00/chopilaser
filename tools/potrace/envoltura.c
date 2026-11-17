/* ChopiLaser: envoltura mínima de potracelib para WebAssembly.
 * Copyright (C) 2026 ChopiLaser. Licencia GPL-3.0-or-later (como el resto de ChopiLaser).
 * potracelib es de Peter Selinger, GPL-2.0-or-later (ver third-party-licenses/potrace/).
 *
 * Entrada: mapa de bits de 1 byte por píxel (distinto de 0 = tinta), fila 0 arriba.
 * Salida: un búfer de doubles con los contornos en píxeles, Y hacia arriba desde el borde
 * inferior de la imagen:
 *   [nGrupos, por grupo: nCaminos, por camino: nSegmentos, x0, y0,
 *    por segmento: tipo (1 = curva, 2 = esquina), c0x, c0y, c1x, c1y, c2x, c2y]
 * Un grupo es un contorno exterior con sus huecos directos (como el árbol de potrace). */
#include <stdlib.h>
#include <string.h>
#include "potracelib.h"

static double *salida = NULL;
static size_t usados = 0, capacidad = 0;
static int fallo = 0;

static void poner(double v) {
  if (fallo) return;
  if (usados == capacidad) {
    size_t nueva = capacidad ? capacidad * 2 : 4096;
    double *p = (double *)realloc(salida, nueva * sizeof(double));
    if (!p) { fallo = 1; return; }
    salida = p;
    capacidad = nueva;
  }
  salida[usados++] = v;
}

static int contar(const potrace_path_t *p) {
  int n = 0;
  for (; p; p = p->sibling) n++;
  return n;
}

static void camino(const potrace_path_t *p) {
  const potrace_curve_t *c = &p->curve;
  int n = c->n;
  poner(n);
  poner(c->c[n - 1][2].x);
  poner(c->c[n - 1][2].y);
  for (int i = 0; i < n; i++) {
    poner(c->tag[i]);
    for (int j = 0; j < 3; j++) {
      if (c->tag[i] == POTRACE_CORNER && j == 0) { poner(0); poner(0); continue; }
      poner(c->c[i][j].x);
      poner(c->c[i][j].y);
    }
  }
}

static int grupos = 0;

/* Recorre hermanos exteriores: cada uno con sus huecos; las islas de los huecos son grupos nuevos. */
static void exteriores(const potrace_path_t *p) {
  for (; p; p = p->sibling) {
    poner(1 + contar(p->childlist));
    grupos++;
    camino(p);
    for (const potrace_path_t *h = p->childlist; h; h = h->sibling) camino(h);
    for (const potrace_path_t *h = p->childlist; h; h = h->sibling) exteriores(h->childlist);
  }
}

/* Devuelve el número de doubles de la salida (o -1 si falla); la salida queda en chopi_salida(). */
int chopi_trazar(const unsigned char *bits, int w, int h, int turdsize, int turnpolicy,
                 double alphamax, int opticurve, double opttolerance) {
  usados = 0;
  fallo = 0;
  grupos = 0;
  const int bpw = 8 * (int)sizeof(potrace_word);
  int dy = (w + bpw - 1) / bpw;
  potrace_word *mapa = (potrace_word *)calloc((size_t)dy * (size_t)h, sizeof(potrace_word));
  if (!mapa) return -1;
  for (int y = 0; y < h; y++) {
    /* La fila 0 de potrace es la de abajo de la imagen. */
    const unsigned char *fila = bits + (size_t)(h - 1 - y) * (size_t)w;
    potrace_word *linea = mapa + (size_t)y * (size_t)dy;
    for (int x = 0; x < w; x++)
      if (fila[x]) linea[x / bpw] |= ((potrace_word)1) << (bpw - 1 - (x % bpw));
  }
  potrace_bitmap_t bm = { w, h, dy, mapa };
  potrace_param_t *param = potrace_param_default();
  if (!param) { free(mapa); return -1; }
  param->turdsize = turdsize;
  param->turnpolicy = turnpolicy;
  param->alphamax = alphamax;
  param->opticurve = opticurve;
  param->opttolerance = opttolerance;
  potrace_state_t *st = potrace_trace(param, &bm);
  free(mapa);
  potrace_param_free(param);
  if (!st || st->status != POTRACE_STATUS_OK) {
    if (st) potrace_state_free(st);
    return -1;
  }
  poner(0); /* hueco para nGrupos */
  exteriores(st->plist);
  potrace_state_free(st);
  if (fallo) return -1;
  salida[0] = grupos;
  return (int)usados;
}

double *chopi_salida(void) { return salida; }

unsigned char *chopi_reservar(int n) { return (unsigned char *)malloc((size_t)n); }

void chopi_liberar(void *p) { free(p); }
