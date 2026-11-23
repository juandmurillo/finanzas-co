package co.caudal.finanzas;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Cifra la sesión de la cuenta de Caudal con una llave AES-256 que vive en Android Keystore y nunca sale de él.
 * Python la usa desde {@code finanzas.infra.sesion_segura} con {@code jclass}. Formato: IV (12 bytes) + texto cifrado
 * con su etiqueta GCM. Si la app se reinstala la llave cambia y la sesión guardada deja de abrirse: hay que volver a
 * entrar, sin tocar los datos del libro.
 */
public final class CifradoSesion {
    private static final String ALMACEN = "AndroidKeyStore";
    private static final String ALIAS = "caudal-sesion";
    private static final String TRANSFORMACION = "AES/GCM/NoPadding";
    private static final int LARGO_IV = 12;

    private CifradoSesion() {}

    private static synchronized SecretKey llave() throws GeneralSecurityException, java.io.IOException {
        KeyStore almacen = KeyStore.getInstance(ALMACEN);
        almacen.load(null);
        KeyStore.Entry entrada = almacen.getEntry(ALIAS, null);
        if (entrada instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entrada).getSecretKey();
        }
        KeyGenerator generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ALMACEN);
        generador.init(new KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generador.generateKey();
    }

    public static byte[] cifrar(byte[] datos) throws Exception {
        Cipher cifrador = Cipher.getInstance(TRANSFORMACION);
        cifrador.init(Cipher.ENCRYPT_MODE, llave());
        byte[] iv = cifrador.getIV();
        byte[] cuerpo = cifrador.doFinal(datos);
        byte[] salida = Arrays.copyOf(iv, iv.length + cuerpo.length);
        System.arraycopy(cuerpo, 0, salida, iv.length, cuerpo.length);
        return salida;
    }

    public static byte[] descifrar(byte[] datos) throws Exception {
        if (datos.length <= LARGO_IV) {
            throw new GeneralSecurityException("Sesión incompleta");
        }
        Cipher cifrador = Cipher.getInstance(TRANSFORMACION);
        cifrador.init(Cipher.DECRYPT_MODE, llave(), new GCMParameterSpec(128, datos, 0, LARGO_IV));
        return cifrador.doFinal(datos, LARGO_IV, datos.length - LARGO_IV);
    }
}
