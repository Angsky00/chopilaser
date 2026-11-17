# Fase 0 frente a la maqueta de Marketing

Capturas generadas con `npm run build && node tools/capturas.mjs /workspace/chopilaser_maqueta`
(Chromium headless, 1280×800 y 390×844, sin desbordamiento horizontal). El perfil de las capturas
es de PRUEBA (sMax 1000, 400 × 400 mm), no el de la máquina de Angel.

| Vista | App (fase 0) | Maqueta |
|---|---|---|
| Configuración, primera vez (sin errores a la vista) | `configuracion-primera-vez_1280.png`, `configuracion-primera-vez_390.png` | `maqueta-configuracion_1280.png`, `maqueta-configuracion_390.png` |
| Configuración tras pulsar «Guardar y empezar» vacía (errores) | `configuracion-errores_1280.png`, `configuracion-errores_390.png` | — |
| Configuración llena (preset + $$) | `configuracion-llena_1280.png`, `configuracion-llena_390.png` | — |
| Área avanzada por coordenadas | `configuracion-avanzado_1280.png`, `configuracion-avanzado_390.png` | — |
| «Máquina» (editar perfil) | `maquina-editar_1280.png`, `maquina-editar_390.png` | — |
| Cuadrícula de prueba | `cuadricula_1280.png`, `cuadricula_390.png` | — |
| Exportar | `exportar_1280.png`, `exportar_390.png` | `maqueta-exportar_1280.png`, `maqueta-exportar_390.png` |

## Diferencias de contenido (intencionales)

De la maqueta se toma solo el estilo. Los textos son los de Marketing ya aprobados en la app.

- Sin el aviso «Valores supuestos» ni el perfil «DLC32 genérico»: la app no supone valores.
- Sin el texto superior «Primera vez · perfil de máquina» ni los textos de ayuda propios de la maqueta.
- Sin barra de vistas (Materiales, Editor, G-code) ni botón «Paro»: son fases 1 y 2 o no aplican
  (la app no controla la máquina, solo trabaja por SD).
- Sin el indicador «Listo para SD» ni el pie «Camino Digital · Calkiní, Campeche»: no son textos de Marketing para la app.
- La exportación de la fase 0 no es un diálogo con resumen y validaciones: es el botón «Exportar .gcode»
  con el G-code a la vista. El diálogo con resumen queda para una fase posterior.

## Diferencias de estilo (con motivo)

- Esquina del origen como lista desplegable, no como rejilla de 4 botones: conserva el id y el
  data-testid `origen` (un `<select>`), funciona igual con teclado y lector de pantalla, y admite la
  opción «Avanzado: área por coordenadas (mm)».
- Borde de los campos en `--line-hot` (`#2f7eab`) en vez de `--line` (`#1e5378`): `--line` daba 1.9:1
  sobre el panel y WCAG 1.4.11 pide 3:1 para el borde de un control.
- Errores en `#ff8f8f`: el rojo de la maqueta (`#c42b2b`) no llega a 4.5:1 como texto sobre los paneles.
- Botón deshabilitado en `--bg-lift` con texto `--text-mute` (5.5:1), en vez de un naranja apagado.
- Sin la textura de líneas horizontales (`.app::before`) ni la altura fija de la app: la página hace
  scroll normal, para que el formulario quepa entero en 390 px.
- Solo Rajdhani 500, 600 y 700 (woff2, subconjunto latino); la maqueta incluía también la 400 en TTF.
