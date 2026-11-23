"""Sesión de la cuenta de Caudal guardada fuera de la base y del navegador.

Se protege con lo que ofrece el sistema, y la cabecera del archivo dice con qué:
- Windows: DPAPI (CryptProtectData); solo el mismo usuario en el mismo equipo puede leerla.
- Android (Chaquopy): AES-GCM con una llave de Android Keystore que nunca sale del sistema
  (`co.caudal.finanzas.CifradoSesion`).
- Otros sistemas: el directorio privado de la app con permisos 0600.
Lo que no se puede abrir (otro equipo, otro usuario, app reinstalada) se trata como sin sesión.
"""

import ctypes
import importlib.util
import json
import os
import sys
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Literal

_ENTROPIA = b"Caudal-sesion-v1"
_CABECERA_DPAPI = b"DPAPI1\n"
_CABECERA_KEYSTORE = b"AKS1\n"
_candado = threading.Lock()

Proteccion = Literal["dpapi", "keystore", "archivo"]


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(datos: bytes) -> _Blob:
    memoria = ctypes.create_string_buffer(datos, len(datos))
    return _Blob(len(datos), ctypes.cast(memoria, ctypes.POINTER(ctypes.c_char)))


def _dpapi(datos: bytes, proteger: bool) -> bytes:
    # getattr: windll solo existe en Windows y así mypy pasa en cualquier sistema.
    windll = getattr(ctypes, "windll")  # noqa: B009
    crypt32, kernel32 = windll.crypt32, windll.kernel32
    entrada, entropia, salida = _blob(datos), _blob(_ENTROPIA), _Blob()
    funcion = crypt32.CryptProtectData if proteger else crypt32.CryptUnprotectData
    sin_interfaz = 0x1  # CRYPTPROTECT_UI_FORBIDDEN
    # Ambas funciones comparten firma: datos, descripción, entropía, reservado, aviso, banderas, salida.
    if not funcion(ctypes.byref(entrada), None, ctypes.byref(entropia), None, None, sin_interfaz, ctypes.byref(salida)):
        raise OSError("No se pudo proteger la sesión con el sistema")
    try:
        return ctypes.string_at(salida.pbData, salida.cbData)
    finally:
        kernel32.LocalFree(salida.pbData)


def _keystore(datos: bytes, proteger: bool) -> bytes:
    from java import jclass  # type: ignore[import-not-found]  # solo existe dentro de Chaquopy

    cifrado = jclass("co.caudal.finanzas.CifradoSesion")
    return bytes(cifrado.cifrar(datos) if proteger else cifrado.descifrar(datos))


def proteccion_del_sistema() -> Proteccion:
    if sys.platform == "win32":
        return "dpapi"
    # El módulo `java` solo existe dentro de Chaquopy, es decir, en la app Android.
    return "keystore" if "java" in sys.modules or importlib.util.find_spec("java") else "archivo"


_CIFRADORES: dict[Proteccion, tuple[bytes, Callable[[bytes, bool], bytes]]] = {
    "dpapi": (_CABECERA_DPAPI, _dpapi),
    "keystore": (_CABECERA_KEYSTORE, _keystore),
}


class SesionSegura:
    def __init__(self, ruta: Path, proteccion: Proteccion | None = None) -> None:
        self.ruta = ruta
        self.proteccion = proteccion or proteccion_del_sistema()

    def _leer(self) -> dict[str, str]:
        try:
            crudo = self.ruta.read_bytes()
        except FileNotFoundError:
            return {}
        try:
            for cabecera, cifrador in _CIFRADORES.values():
                if crudo.startswith(cabecera):
                    crudo = cifrador(crudo[len(cabecera) :], False)
                    break
            datos = json.loads(crudo)
        except Exception:  # noqa: BLE001 — incluye los errores de Java que trae Chaquopy
            # Copiada de otro equipo o usuario, o llave nueva tras reinstalar: hay que volver a iniciar sesión.
            return {}
        return {str(k): str(v) for k, v in datos.items()} if isinstance(datos, dict) else {}

    def _escribir(self, datos: dict[str, str]) -> None:
        if not datos:
            self.ruta.unlink(missing_ok=True)
            return
        crudo = json.dumps(datos, separators=(",", ":")).encode()
        if self.proteccion in _CIFRADORES:
            cabecera, cifrador = _CIFRADORES[self.proteccion]
            crudo = cabecera + cifrador(crudo, True)
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        temporal = self.ruta.with_suffix(".tmp")
        descriptor = os.open(temporal, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "wb") as archivo:
            archivo.write(crudo)
        os.replace(temporal, self.ruta)

    def obtener(self, clave: str) -> str | None:
        with _candado:
            return self._leer().get(clave)

    def guardar(self, clave: str, valor: str) -> None:
        with _candado:
            self._escribir({**self._leer(), clave: valor})

    def borrar(self, clave: str) -> None:
        with _candado:
            datos = self._leer()
            if datos.pop(clave, None) is not None:
                self._escribir(datos)
