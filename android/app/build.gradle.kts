plugins {
    id("com.android.application")
    id("com.chaquo.python")
}

// Recursos que la API necesita como archivos reales: las migraciones de Alembic y el frontend compilado. Viajan
// como un paquete de Python que se extrae al almacenamiento de la app.
val recursos = layout.buildDirectory.dir("generated/caudal-python")
// -PcaudalWebDir=… usa otro frontend compilado (el del piloto trae la configuración de Supabase).
val frontend = file(findProperty("caudalWebDir") ?: "../../app/frontend/dist")
// -PcaudalSyncReceptor=http://127.0.0.1:8090 apunta la app a un receptor (piloto con `adb reverse`).
val receptorSync = findProperty("caudalSyncReceptor")?.toString()
// -PcaudalSyncApikey=sb_publishable_… cuando el receptor es supabase+https://… (clave publicable, nunca la secreta).
val apikeySync = findProperty("caudalSyncApikey")?.toString()
val empaquetarRecursos by tasks.registering(Copy::class) {
    from("../../app/backend") {
        // Chaquopy compila el código a .pyc; en un paquete extraído deja también los .py, que es lo que lee Alembic.
        include("alembic.ini", "alembic/env.py", "alembic/script.py.mako", "alembic/versions/*.py")
    }
    from(frontend) {
        into("web")
    }
    into(recursos.map { it.dir("finanzas_recursos") })
    doFirst {
        check(frontend.resolve("index.html").exists()) {
            "Falta el frontend compilado: en app/frontend correr `npm run build` antes de compilar el APK."
        }
    }
    inputs.property("receptorSync", receptorSync ?: "")
    inputs.property("apikeySync", apikeySync ?: "")
    doLast {
        recursos.get().file("finanzas_recursos/__init__.py").asFile.writeText("")
        val sync = recursos.get().file("finanzas_recursos/sync.json").asFile
        if (receptorSync.isNullOrBlank()) {
            sync.delete()
        } else {
            sync.writeText("{\"receptor\": \"$receptorSync\", \"apikey\": \"${apikeySync ?: ""}\"}")
        }
    }
}

android {
    namespace = "co.caudal.finanzas"
    // Google Play exige targetSdk 36 (Android 16) a apps nuevas y actualizaciones desde el 31-ago-2026.
    compileSdk = 37

    defaultConfig {
        applicationId = "co.caudal.finanzas"
        minSdk = 24
        targetSdk = 36
        // -PcaudalVersionCode=… y -PcaudalVersion=… desde la CI (la etiqueta de la versión); en local, la de prueba.
        versionCode = (findProperty("caudalVersionCode") ?: "1").toString().toInt()
        versionName = (findProperty("caudalVersion") ?: "0.1.0-prueba").toString()
        ndk {
            // arm64 para teléfonos; x86_64 para el emulador.
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }
    // Firma de distribución: solo si existen las variables (en la CI, secretos del repositorio). La llave y sus
    // contraseñas nunca viven en el repositorio; sin ellas, `assembleRelease` produce un APK sin firmar.
    val almacen = System.getenv("CAUDAL_KEYSTORE")
    signingConfigs {
        if (!almacen.isNullOrBlank()) {
            create("distribucion") {
                storeFile = file(almacen)
                storePassword = System.getenv("CAUDAL_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("CAUDAL_KEY_ALIAS")
                keyPassword = System.getenv("CAUDAL_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("release") {
            // Sin R8: Chaquopy usa clases Java por reflexión (CifradoSesion) y el código Python no se reduce.
            isMinifyEnabled = false
            if (!almacen.isNullOrBlank()) signingConfig = signingConfigs.getByName("distribucion")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

chaquopy {
    defaultConfig {
        version = "3.13"
        pip {
            // PyPI no publica pydantic-core para Android; el índice de Flet sí (ver docs/sistema/07_PLAN_ANDROID.md).
            options("--extra-index-url", "https://pypi.flet.dev")
            install("-r", "requirements-android.txt")
        }
        extractPackages("finanzas_recursos")
    }
    sourceSets {
        getByName("main") {
            srcDir("../../app/backend/src")
            srcDir(recursos)
        }
    }
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("PythonSources") }.configureEach {
    dependsOn(empaquetarRecursos)
}
