# Caudal para Android

App Android que arranca la API de Caudal **dentro del teléfono** con Python embebido (Chaquopy) y muestra la misma
interfaz web en un WebView. Plan completo en `docs/sistema/07_PLAN_ANDROID.md`.

**Estado (10-nov-2026):** fases 0 y 1 hechas. El APK arranca la API con `finanzas.portatil`, muestra la interfaz
completa en un WebView y funciona en modo avión: arranque con datos 2,5 a 2,7 s en el emulador, APK de depuración de
unos 50 MB. Detalle en `docs/sistema/07_PLAN_ANDROID.md`.

## Cómo funciona

- `app/src/main/python/arranque.py` llama `finanzas.portatil.iniciar()`: migra si hace falta y sirve la API y el
  frontend en `127.0.0.1:47613` (u otro puerto si está ocupado), con un secreto nuevo en cada arranque.
- `MainActivity` abre `/entrar?secreto=…`; la API deja una cookie y desde ahí todo viaja con ella. Otra app del
  teléfono que llame a ese puerto recibe 401.
- Gradle empaqueta en `finanzas_recursos` las migraciones de Alembic y `app/frontend/dist`.
- Dependencias fijadas en `app/requirements-android.txt`; `pydantic_core` sale del índice de Flet.
- Probar el puente en el computador: `python app/src/main/python/arranque.py <carpeta-temporal>`.
- La sesión de la cuenta de Caudal se cifra con Android Keystore (`CifradoSesion.java`, llamada desde
  `finanzas.infra.sesion_segura`); ver `docs/sistema/12_PLAN_PRODUCCION_Y_SINCRONIZACION.md`.
- **Importar.** Los `<input type="file">` abren el selector de documentos del sistema (`ACTION_OPEN_DOCUMENT`), sin pedir permisos de almacenamiento.
- **Exportar.** Las descargas de la API local (JSON, copia SQLite, Excel) preguntan dónde guardar (`ACTION_CREATE_DOCUMENT`). La app baja el archivo con la cookie de la sesión y lo escribe ahí. Ambas cosas están en `MainActivity`.
- **Piloto de sincronización.** `-PcaudalWebDir`, `-PcaudalSyncReceptor` y `-PcaudalSyncApikey` compilan el APK apuntando a un receptor. Sin esas opciones, el APK normal no cambia.

- **SDK.** `targetSdk 36`, que Google Play exige desde el 31-ago-2026, y `compileSdk 37`. «Atrás» usa `OnBackInvokedCallback` en Android 13 y posteriores.
- **Release.** `./gradlew assembleRelease bundleRelease -PcaudalVersion=1.2.3 -PcaudalVersionCode=10203` produce el APK y el AAB. Se firman solo si existen `CAUDAL_KEYSTORE`, `CAUDAL_KEYSTORE_PASSWORD`, `CAUDAL_KEY_ALIAS` y `CAUDAL_KEY_PASSWORD`.
- **Páginas de 16 KB.** `python revisar_16kb.py <apk>` revisa la alineación de cada biblioteca nativa, incluidas las de Chaquopy.

## Qué falta

Ícono y colores propios, probar en tu celular, y la llave de subida para firmar.

## Compilar

Antes: compilar el frontend (`app/frontend`: `npm run build`); Gradle copia `dist/` dentro del APK.

Requisitos: JDK 17, SDK de Android (plataforma 35, build-tools 35) y Python 3.13 en el equipo (Chaquopy lo usa
para pip). `local.properties` lleva `sdk.dir=C:/Users/<usuario>/AppData/Local/Android/Sdk` con barras `/`: las `\`
se pierden. Si la red intercepta TLS, exportar `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`.

```bash
./gradlew assembleDebug
```

El APK queda en `app/build/outputs/apk/debug/`. Con Android Studio: abrir esta carpeta y pulsar Run.
