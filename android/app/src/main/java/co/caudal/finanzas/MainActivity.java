package co.caudal.finanzas;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import com.chaquo.python.Python;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Caudal dentro del teléfono: arranca la API en un hilo con Python embebido y muestra la misma interfaz web en un
 * WebView. La URL de entrada lleva el secreto de este arranque; desde ahí todo viaja con una cookie.
 */
public class MainActivity extends Activity {
    private static final String ETIQUETA = "Caudal";
    private static final int ELEGIR_ARCHIVO = 1;
    private static final int GUARDAR_ARCHIVO = 2;
    private WebView web;
    private TextView estado;
    /** Respuesta pendiente para un <input type="file"> de la página. */
    private ValueCallback<Uri[]> archivoPedido;
    /** Exportación de la API local que espera a que la persona elija dónde guardarla. */
    private String descargaPendiente;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        FrameLayout caja = new FrameLayout(this);
        caja.setFitsSystemWindows(true);
        web = new WebView(this);
        WebSettings ajustes = web.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setAllowFileAccess(false);
        ajustes.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient());
        // Importar: el selector de documentos del sistema (sin permisos de almacenamiento).
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView vista, ValueCallback<Uri[]> respuesta, FileChooserParams opciones) {
                if (archivoPedido != null) archivoPedido.onReceiveValue(null);
                archivoPedido = respuesta;
                // La página acepta por extensión (.json, .db, .csv) y Android filtra por tipo MIME, que para
                // esos archivos varía según quién los creó: se ofrece todo y la API valida el contenido.
                Intent elegir = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("*/*")
                        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                                opciones.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(elegir, ELEGIR_ARCHIVO);
                } catch (Exception e) {
                    archivoPedido = null;
                    respuesta.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });
        // Exportar: la persona elige dónde guardar y la app copia ahí lo que entrega su propia API.
        web.setDownloadListener((url, agente, disposicion, tipo, largo) -> {
            if (!url.startsWith("http://127.0.0.1:")) return;
            descargaPendiente = url;
            Intent guardar = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(tipo == null || tipo.isEmpty() ? "application/octet-stream" : tipo)
                    .putExtra(Intent.EXTRA_TITLE, URLUtil.guessFileName(url, disposicion, tipo));
            startActivityForResult(guardar, GUARDAR_ARCHIVO);
        });
        web.setVisibility(View.INVISIBLE);
        estado = new TextView(this);
        estado.setGravity(Gravity.CENTER);
        estado.setPadding(48, 48, 48, 48);
        estado.setText("Abriendo Caudal…");
        caja.addView(web);
        caja.addView(estado);
        setContentView(caja);

        // Desde Android 13 «atrás» llega por OnBackInvokedDispatcher; con targetSdk 36 onBackPressed ya no se llama.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::atras);
        }
        new Thread(this::arrancar, "caudal-arranque").start();
    }

    private void arrancar() {
        try {
            String salida = Python.getInstance().getModule("arranque")
                    .callAttr("iniciar", getFilesDir().getAbsolutePath() + "/datos").toString();
            JSONObject r = new JSONObject(salida);
            Log.i(ETIQUETA, "Python " + r.getString("python") + " · migró " + r.getBoolean("migro")
                    + " · tiempos " + r.getJSONObject("tiempos"));
            String url = r.getString("url");
            runOnUiThread(() -> {
                web.loadUrl(url);
                web.setVisibility(View.VISIBLE);
                estado.setVisibility(View.GONE);
            });
        } catch (Throwable e) {
            Log.e(ETIQUETA, "No arrancó", e);
            runOnUiThread(() -> estado.setText("Caudal no pudo arrancar:\n" + e.getMessage()));
        }
    }

    @Override
    protected void onActivityResult(int codigo, int resultado, Intent datos) {
        super.onActivityResult(codigo, resultado, datos);
        if (codigo == ELEGIR_ARCHIVO && archivoPedido != null) {
            archivoPedido.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, datos));
            archivoPedido = null;
        } else if (codigo == GUARDAR_ARCHIVO) {
            String url = descargaPendiente;
            descargaPendiente = null;
            if (resultado != RESULT_OK || datos == null || datos.getData() == null || url == null) return;
            Uri destino = datos.getData();
            new Thread(() -> guardar(url, destino), "caudal-exportar").start();
        }
    }

    /** Baja la exportación de la API local (con la cookie de esta sesión) y la escribe donde se eligió. */
    private void guardar(String url, Uri destino) {
        HttpURLConnection conexion = null;
        try {
            conexion = (HttpURLConnection) new URL(url).openConnection();
            String galleta = CookieManager.getInstance().getCookie(url);
            if (galleta != null) conexion.setRequestProperty("Cookie", galleta);
            if (conexion.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("La exportación respondió " + conexion.getResponseCode());
            }
            try (InputStream entrada = conexion.getInputStream();
                 OutputStream salida = getContentResolver().openOutputStream(destino)) {
                if (salida == null) throw new IllegalStateException("No se pudo abrir el destino");
                byte[] bloque = new byte[64 * 1024];
                for (int n; (n = entrada.read(bloque)) > 0; ) salida.write(bloque, 0, n);
            }
            runOnUiThread(() -> Toast.makeText(this, "Archivo guardado", Toast.LENGTH_SHORT).show());
        } catch (Exception e) {
            Log.e(ETIQUETA, "No se pudo exportar", e);
            runOnUiThread(() -> Toast.makeText(this, "No se pudo guardar el archivo", Toast.LENGTH_LONG).show());
        } finally {
            if (conexion != null) conexion.disconnect();
        }
    }

    /**
     * Atrás cierra primero la capa visible (hoja, menú, captura): la página expone window.caudalAtras(),
     * que devuelve true si cerró algo. Si no había capa, se navega atrás o se sale.
     */
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        atras();  // Android 12 y anteriores
    }

    private void atras() {
        if (web.getVisibility() != View.VISIBLE) {
            finish();
            return;
        }
        web.evaluateJavascript("Boolean(window.caudalAtras && window.caudalAtras())", resultado -> {
            if ("true".equals(resultado)) return;
            if (web.canGoBack()) {
                web.goBack();
            } else {
                finish();
            }
        });
    }
}
