"""Genera caudal.ico con el logo de la app (cuadrado verde redondeado y círculo lima).

Mismos colores que `.cd-logo-mark` en app/frontend/src/app/navegacion.css.
Uso: python icono.py  (requiere Pillow; construir.ps1 lo instala en el entorno de compilación).
"""

from pathlib import Path

from PIL import Image, ImageDraw

FONDO = "#1e4d3b"
CIRCULO = "#b9f046"
TAMANOS = [16, 24, 32, 48, 64, 128, 256]


def dibujar(lado: int = 1024) -> Image.Image:
    imagen = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    lienzo = ImageDraw.Draw(imagen)
    lienzo.rounded_rectangle((0, 0, lado - 1, lado - 1), radius=int(lado * 0.24), fill=FONDO)
    radio = lado * 0.21
    centro = lado / 2
    lienzo.ellipse((centro - radio, centro - radio, centro + radio, centro + radio), fill=CIRCULO)
    return imagen


if __name__ == "__main__":
    destino = Path(__file__).with_name("caudal.ico")
    dibujar().save(destino, sizes=[(t, t) for t in TAMANOS])
    print(f"Ícono en {destino}")
