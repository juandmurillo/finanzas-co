"""Revisa que las bibliotecas nativas de un APK funcionen en dispositivos con páginas de 16 KB.

Android 15+ en esos dispositivos exige que cada segmento LOAD de un .so esté alineado a 16 KB o más.
Se revisan los .so del APK y los que Chaquopy empaqueta dentro de sus archivos de assets (.imy/.zip).
Uso: python revisar_16kb.py app/build/outputs/apk/debug/app-debug.apk [--abi arm64-v8a]
Sale con código 1 si alguna biblioteca de la ABI revisada no cumple.
"""

import io
import struct
import sys
import zipfile

MINIMO = 16 * 1024


def alineacion_minima(elf: bytes) -> int | None:
    """La menor alineación entre los segmentos LOAD (None si no es un ELF de 64 bits)."""
    if elf[:4] != b"\x7fELF" or elf[4] != 2:
        return None
    orden = "<" if elf[5] == 1 else ">"
    (phoff,) = struct.unpack_from(orden + "Q", elf, 0x20)
    phentsize, phnum = struct.unpack_from(orden + "HH", elf, 0x36)
    alineaciones = []
    for i in range(phnum):
        base = phoff + i * phentsize
        (tipo,) = struct.unpack_from(orden + "I", elf, base)
        if tipo == 1:  # PT_LOAD
            (alineacion,) = struct.unpack_from(orden + "Q", elf, base + 0x30)
            alineaciones.append(alineacion)
    return min(alineaciones) if alineaciones else None


def recorrer(archivo: zipfile.ZipFile, prefijo: str = ""):
    for nombre in archivo.namelist():
        if nombre.endswith(".so"):
            yield prefijo + nombre, archivo.read(nombre)
        elif nombre.endswith((".imy", ".zip")):
            with zipfile.ZipFile(io.BytesIO(archivo.read(nombre))) as interno:
                yield from recorrer(interno, f"{prefijo}{nombre}!")


def main() -> int:
    apk = sys.argv[1]
    abi = sys.argv[sys.argv.index("--abi") + 1] if "--abi" in sys.argv else "arm64-v8a"
    malas, revisadas = [], 0
    with zipfile.ZipFile(apk) as archivo:
        for nombre, contenido in recorrer(archivo):
            if abi not in nombre:
                continue
            alineacion = alineacion_minima(contenido)
            if alineacion is None:
                continue
            revisadas += 1
            if alineacion < MINIMO:
                malas.append((nombre, alineacion))
    for nombre, alineacion in malas:
        print(f"NO  {alineacion:>6}  {nombre}")
    print(f"{revisadas} bibliotecas {abi} revisadas, {len(malas)} sin alineación de 16 KB")
    return 1 if malas else 0


if __name__ == "__main__":
    raise SystemExit(main())
