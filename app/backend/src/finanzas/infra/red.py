"""Conexiones HTTPS con los certificados del sistema operativo.

Con los de certifi, una red que inspecciona TLS (empresa, antivirus) rechaza la conexión aunque el
sistema confíe en ella. truststore usa el almacén de Windows, macOS o Linux; donde no aplica
(Android con Chaquopy) se usa la verificación por defecto de httpx. Nunca se desactiva la verificación.
"""

import ssl
from functools import cache


@cache
def verificacion_tls() -> ssl.SSLContext | bool:
    try:
        import truststore

        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:  # noqa: BLE001 — sin almacén del sistema disponible se usa certifi
        return True
