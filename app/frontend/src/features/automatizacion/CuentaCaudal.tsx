import { api } from "@/shared/lib/api";
import { almacenSesion, auth, CLAVE_SESION, verificacionDelCorreo } from "@/shared/lib/cuentaCaudal";
import { claves } from "@/shared/lib/queryKeys";
import { escuchar, estadoActual, necesitaUnirse, type ResultadoUnion } from "@/shared/lib/syncCaudal";
import { Hecho, UnirLibro } from "./UnirLibro";
import { type Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore, useState, type FormEvent } from "react";

function textoPendientes(n: number): string {
  return n === 1 ? "1 cambio está solo en este equipo" : `${n} cambios están solo en este equipo`;
}

export function CuentaCaudal() {
  const [sesion, setSesion] = useState<Session | null>(null);
  const estado = useSyncExternalStore(escuchar, estadoActual);
  const local = useQuery({ queryKey: claves.estadoSync, queryFn: api.estadoSync, enabled: sesion !== null });
  const pendientes = local.data?.pendientes ?? 0;
  const [correo, setCorreo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [union, setUnion] = useState<ResultadoUnion>();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const suscripcion = auth?.onAuthStateChange((_evento, actual) => setSesion(actual));
    return () => suscripcion?.data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    // Mientras se espera el correo, el enlace puede abrirse en otro navegador del mismo equipo: la
    // sesión queda en la API local y aquí basta recargar para tomarla.
    if (!enviado || sesion) return;
    async function revisar() {
      if (await almacenSesion.getItem(CLAVE_SESION)) window.location.reload();
    }
    const intervalo = window.setInterval(() => void revisar(), 3000);
    window.addEventListener("focus", revisar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener("focus", revisar);
    };
  }, [enviado, sesion]);

  async function cerrarSesion() {
    if (!auth || ocupado) return;
    setError("");
    setOcupado(true);
    try {
      // Solo este equipo: la sesión de los demás y los datos locales no se tocan.
      const resultado = await auth.signOut({ scope: "local" });
      if (resultado.error) throw resultado.error;
      setCorreo("");
      setEnviado(false);
      setCerrando(false);
    } catch {
      setError("No se pudo cerrar la sesión. Inténtalo de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!auth || ocupado || sesion) return;
    setError("");
    setOcupado(true);
    try {
      if (enviado) {
        const datos = verificacionDelCorreo(codigo);
        if (!datos) throw new Error();
        const resultado = await auth.verifyOtp(
          "token_hash" in datos ? datos : { email: correo.trim(), token: datos.token, type: "email" },
        );
        if (resultado.error || !resultado.data.session) throw new Error();
        setCodigo("");
      } else {
        const resultado = await auth.signInWithOtp({ email: correo.trim() });
        if (resultado.error) throw resultado.error;
        setEnviado(true);
      }
    } catch (e) {
      const limite = typeof e === "object" && e !== null && "status" in e && e.status === 429;
      setError(
        limite
          ? "Se alcanzó el límite de correos de acceso por hora. Usa el último correo recibido o inténtalo más tarde."
          : enviado
            ? "No se pudo verificar. Pega el enlace completo o el código del último correo y revisa la conexión."
            : "No se pudo enviar el código. Comprueba la conexión y vuelve a intentarlo.",
      );
    } finally {
      setOcupado(false);
    }
  }
  return (
    <section className="cd-card cd-stack">
      <h2 className="cd-card-title">Cuenta de Caudal</h2>
      {!auth ? (
        <p>El acceso por correo está pendiente de configuración en esta instalación.</p>
      ) : sesion ? (
        <div className="cd-stack">
          <p>Sesión iniciada con {sesion.user.email}. Se mantiene al reiniciar y sin conexión.</p>
          <p role="status">{estado}</p>
          {pendientes > 0 && (
            <p className="cd-muted">
              {textoPendientes(pendientes)} y {pendientes === 1 ? "se enviará" : "se enviarán"} al sincronizar.
            </p>
          )}
          {union ? (
            <Hecho resultado={union} cerrar={() => setUnion(undefined)} />
          ) : (
            necesitaUnirse(estado) && <UnirLibro key={estado} sesion={sesion} onHecho={setUnion} />
          )}
          {error && <p role="alert">{error}</p>}
          {cerrando ? (
            <div className="cd-stack" role="group" aria-label="Cerrar sesión">
              <p>
                {pendientes > 0
                  ? `${textoPendientes(pendientes)}. Se conservan aquí y se enviarán cuando vuelvas a entrar con la misma cuenta.`
                  : "Todo está enviado. Tus datos siguen en este equipo."}
              </p>
              <div className="cd-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  className="cd-btn cd-btn--primary"
                  type="button"
                  disabled={ocupado}
                  onClick={() => void cerrarSesion()}
                >
                  Cerrar sesión
                </button>
                <button className="cd-btn cd-btn--ghost" type="button" onClick={() => setCerrando(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              className="cd-btn"
              type="button"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                setCerrando(true);
                void local.refetch();
              }}
            >
              Cerrar sesión en este equipo
            </button>
          )}
        </div>
      ) : (
        <form className="cd-stack" onSubmit={enviar}>
          <label>
            Correo electrónico
            <input
              className="cd-input"
              type="email"
              autoComplete="email"
              value={correo}
              required
              disabled={ocupado || enviado}
              onChange={(e) => setCorreo(e.target.value)}
            />
          </label>
          {enviado ? (
            <>
              <label>
                Código o enlace del correo
                <input
                  className="cd-input"
                  autoComplete="one-time-code"
                  required
                  value={codigo}
                  disabled={ocupado}
                  aria-describedby="ayuda-codigo"
                  onChange={(e) => setCodigo(e.target.value)}
                />
              </label>
              <p className="cd-muted" id="ayuda-codigo">
                En este equipo basta con abrir el enlace del correo: esta pantalla se actualiza sola. Si lo recibes en
                otro dispositivo, copia el enlace («Copiar dirección del enlace») sin abrirlo y pégalo aquí, o escribe
                el código si el correo lo trae.
              </p>
              <button
                className="cd-link"
                type="button"
                disabled={ocupado}
                onClick={() => {
                  setEnviado(false);
                  setCodigo("");
                  setError("");
                }}
              >
                Cambiar correo o solicitar otro código
              </button>
            </>
          ) : (
            <p>Si es tu primera vez, el código te permitirá crear tu cuenta.</p>
          )}
          {error && <p role="alert">{error}</p>}
          <button className="cd-btn cd-btn--primary" disabled={ocupado}>
            {enviado ? "Verificar código" : "Enviar código"}
          </button>
        </form>
      )}
    </section>
  );
}
