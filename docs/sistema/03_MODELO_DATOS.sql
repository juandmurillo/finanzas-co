-- Modelo de datos — Finanzas (SQLite). Borrador v1, 28-oct-2026.
-- La fuente definitiva serán las migraciones Alembic; este archivo es la referencia de diseño.
-- Convenciones: montos en CENTAVOS (INTEGER), fechas ISO-8601 TEXT con zona America/Bogota,
-- ids INTEGER autoincrementales, borrado lógico con archivado_en.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE cuenta (
    id              INTEGER PRIMARY KEY,
    nombre          TEXT    NOT NULL UNIQUE,              -- Billetera, Efectivo, Ahorro
    tipo            TEXT    NOT NULL CHECK (tipo IN ('efectivo','ahorro','billetera','tarjeta_credito','credito','inversion','por_cobrar','por_pagar')),
    institucion     TEXT,
    moneda          TEXT    NOT NULL DEFAULT 'COP',
    saldo_inicial   INTEGER NOT NULL DEFAULT 0,           -- centavos
    exenta_gmf      INTEGER NOT NULL DEFAULT 0,           -- 4x1000
    color           TEXT,
    icono           TEXT,
    orden           INTEGER NOT NULL DEFAULT 0,
    archivado_en    TEXT
);

-- Jerarquía de 3 niveles: nivel 1 = grupo, 2 = categoría, 3 = subcategoría
CREATE TABLE categoria (
    id              INTEGER PRIMARY KEY,
    padre_id        INTEGER REFERENCES categoria(id) ON DELETE RESTRICT,
    nivel           INTEGER NOT NULL CHECK (nivel IN (1,2,3)),
    nombre          TEXT    NOT NULL,
    grupo           TEXT    NOT NULL CHECK (grupo IN ('ingreso','gasto_vida','servicio_deuda','apuestas','ahorro_inversion',
                                                  'prestamos_personales','financiacion','transferencia','ajuste')),
    es_fijo         INTEGER NOT NULL DEFAULT 0,           -- gasto obligatorio (casa, cuotas)
    color           TEXT,
    icono           TEXT,
    archivado_en    TEXT,
    UNIQUE (padre_id, nombre)
);

CREATE TABLE contraparte (                                -- cliente, persona, comercio, banco
    id              INTEGER PRIMARY KEY,
    nombre          TEXT    NOT NULL UNIQUE,
    tipo            TEXT    NOT NULL CHECK (tipo IN ('cliente','persona','comercio','entidad'))
);

CREATE TABLE importacion (
    id              INTEGER PRIMARY KEY,
    origen          TEXT    NOT NULL,                     -- cashew, csv, extracto_davivienda
    archivo         TEXT    NOT NULL,
    hash_archivo    TEXT    NOT NULL UNIQUE,
    filas_leidas    INTEGER NOT NULL,
    filas_creadas   INTEGER NOT NULL,
    duplicadas      INTEGER NOT NULL,
    creado_en       TEXT    NOT NULL
);

CREATE TABLE transaccion (
    id              INTEGER PRIMARY KEY,
    cuenta_id       INTEGER NOT NULL REFERENCES cuenta(id),
    fecha           TEXT    NOT NULL,
    monto           INTEGER NOT NULL CHECK (monto <> 0),   -- centavos; + entra, − sale
    moneda_original TEXT,                                 -- USD si aplica
    monto_original  INTEGER,
    trm             REAL,
    categoria_id    INTEGER REFERENCES categoria(id),      -- nivel 2 o 3; NULL si tiene divisiones
    descripcion     TEXT    NOT NULL DEFAULT '',
    nota            TEXT    NOT NULL DEFAULT '',
    contraparte_id  INTEGER REFERENCES contraparte(id),
    estado          TEXT    NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada','pendiente','por_revisar')),
    transferencia_id INTEGER REFERENCES transaccion(id) ON DELETE CASCADE,  -- par enlazado
    credito_id      INTEGER REFERENCES credito(id),
    prestamo_id     INTEGER REFERENCES prestamo_personal(id),
    recurrente_id   INTEGER REFERENCES recurrente(id),
    meta_id         INTEGER REFERENCES meta(id),
    importacion_id  INTEGER REFERENCES importacion(id),
    huella          TEXT,                                 -- hash para deduplicar importaciones
    creado_en       TEXT    NOT NULL,
    actualizado_en  TEXT    NOT NULL
);
CREATE INDEX ix_tx_fecha        ON transaccion(fecha);
CREATE INDEX ix_tx_cuenta_fecha ON transaccion(cuenta_id, fecha);
CREATE INDEX ix_tx_categoria    ON transaccion(categoria_id, fecha);
CREATE UNIQUE INDEX ux_tx_huella ON transaccion(huella) WHERE huella IS NOT NULL;

CREATE TABLE transaccion_division (                       -- split: cuota = capital + interés + seguro
    id              INTEGER PRIMARY KEY,
    transaccion_id  INTEGER NOT NULL REFERENCES transaccion(id) ON DELETE CASCADE,
    categoria_id    INTEGER NOT NULL REFERENCES categoria(id),
    monto           INTEGER NOT NULL,
    nota            TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE etiqueta (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, color TEXT);
CREATE TABLE transaccion_etiqueta (
    transaccion_id  INTEGER NOT NULL REFERENCES transaccion(id) ON DELETE CASCADE,
    etiqueta_id     INTEGER NOT NULL REFERENCES etiqueta(id) ON DELETE CASCADE,
    PRIMARY KEY (transaccion_id, etiqueta_id)
);

CREATE TABLE credito (
    id              INTEGER PRIMARY KEY,
    nombre          TEXT    NOT NULL,                     -- Crédito de consumo
    entidad         TEXT    NOT NULL,                     -- Banco
    numero          TEXT,
    cuenta_pago_id  INTEGER REFERENCES cuenta(id),
    fecha_desembolso TEXT   NOT NULL,
    capital_inicial INTEGER NOT NULL,
    monto_recibido  INTEGER NOT NULL,
    tasa_ea         REAL    NOT NULL,                     -- 0.6356
    tipo_tasa       TEXT    NOT NULL DEFAULT 'fija',
    plazo_meses     INTEGER NOT NULL,
    cuota           INTEGER NOT NULL,
    seguro_mensual  INTEGER NOT NULL DEFAULT 0,
    dia_pago        INTEGER NOT NULL,
    estado          TEXT    NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','pagado','refinanciado'))
);

CREATE TABLE credito_extracto (                           -- fuente de verdad del saldo
    id              INTEGER PRIMARY KEY,
    credito_id      INTEGER NOT NULL REFERENCES credito(id) ON DELETE CASCADE,
    fecha_corte     TEXT    NOT NULL,
    saldo           INTEGER NOT NULL,
    intereses       INTEGER NOT NULL,
    abono_capital   INTEGER NOT NULL,
    seguros         INTEGER NOT NULL,
    cuotas_pendientes INTEGER NOT NULL,
    archivo         TEXT,
    UNIQUE (credito_id, fecha_corte)
);

-- Préstamos personales de bajo monto (amigos, familia, otras fuentes). Ver RF-PP-01..13.
-- El capital se mueve contra una cuenta tipo 'por_cobrar' / 'por_pagar' (no es ingreso ni gasto);
-- solo interés y condonación generan ingreso/gasto.
CREATE TABLE prestamo_personal (
    id              INTEGER PRIMARY KEY,
    contraparte_id  INTEGER NOT NULL REFERENCES contraparte(id),
    direccion       TEXT    NOT NULL CHECK (direccion IN ('presto_yo','me_prestaron')),
    origen          TEXT    NOT NULL DEFAULT 'amigo' CHECK (origen IN ('amigo','familia','companero','otra_fuente')),
    monto           INTEGER NOT NULL CHECK (monto > 0),       -- capital, centavos
    fecha           TEXT    NOT NULL,
    cuenta_id       INTEGER NOT NULL REFERENCES cuenta(id),   -- de dónde salió / a dónde llegó
    tipo_interes    TEXT    NOT NULL DEFAULT 'ninguno' CHECK (tipo_interes IN ('ninguno','fijo','simple_mensual')),
    interes_fijo    INTEGER,                                  -- si 'fijo': monto total adicional
    tasa_mensual    REAL,                                     -- si 'simple_mensual': 0.01 = 1 % m.v.
    plan            TEXT    NOT NULL DEFAULT 'fecha_unica' CHECK (plan IN ('fecha_unica','cuotas','libre')),
    frecuencia      TEXT    CHECK (frecuencia IN ('semanal','quincenal','mensual')),
    num_cuotas      INTEGER,
    fecha_limite    TEXT,                                     -- fecha única o última cuota
    estado          TEXT    NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','pagado','condonado')),
    recordar_dias_antes INTEGER NOT NULL DEFAULT 2,
    nota            TEXT    NOT NULL DEFAULT '',
    creado_en       TEXT    NOT NULL
);
CREATE INDEX ix_prestamo_estado ON prestamo_personal(estado, direccion);

CREATE TABLE prestamo_cuota (                                 -- plan generado (si plan = 'cuotas' o 'fecha_unica')
    id              INTEGER PRIMARY KEY,
    prestamo_id     INTEGER NOT NULL REFERENCES prestamo_personal(id) ON DELETE CASCADE,
    numero          INTEGER NOT NULL,
    fecha           TEXT    NOT NULL,
    capital         INTEGER NOT NULL,
    interes         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (prestamo_id, numero)
);
-- Los abonos son transacciones con prestamo_id; su reparto va en transaccion_division
-- (capital → cuenta por cobrar/pagar; interés → categoría de ingreso o gasto).

CREATE TABLE presupuesto (
    mes             TEXT    NOT NULL,                     -- 2026-11
    categoria_id    INTEGER NOT NULL REFERENCES categoria(id),
    asignado        INTEGER NOT NULL DEFAULT 0,
    arrastrar       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (mes, categoria_id)
);

CREATE TABLE recurrente (
    id              INTEGER PRIMARY KEY,
    nombre          TEXT    NOT NULL,                     -- Claro pospago
    cuenta_id       INTEGER NOT NULL REFERENCES cuenta(id),
    categoria_id    INTEGER NOT NULL REFERENCES categoria(id),
    monto           INTEGER NOT NULL,
    frecuencia      TEXT    NOT NULL CHECK (frecuencia IN ('semanal','quincenal','mensual','anual')),
    dia             INTEGER NOT NULL,
    inicio          TEXT    NOT NULL,
    fin             TEXT,
    es_suscripcion  INTEGER NOT NULL DEFAULT 0,
    credito_id      INTEGER REFERENCES credito(id),
    activo          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE meta (
    id              INTEGER PRIMARY KEY,
    nombre          TEXT    NOT NULL,
    tipo            TEXT    NOT NULL CHECK (tipo IN ('ahorro','deuda','tope_gasto','habito')),
    objetivo        INTEGER,                              -- monto objetivo o tope
    categoria_id    INTEGER REFERENCES categoria(id),     -- para topes y hábitos (Apuestas = 0)
    fecha_objetivo  TEXT,
    cuenta_id       INTEGER REFERENCES cuenta(id),
    estado          TEXT    NOT NULL DEFAULT 'activa'
);

CREATE TABLE regla (
    id              INTEGER PRIMARY KEY,
    nombre          TEXT    NOT NULL,
    prioridad       INTEGER NOT NULL DEFAULT 100,
    condiciones     TEXT    NOT NULL,                     -- JSON: [{"campo":"descripcion","op":"contiene","valor":"tigo"}]
    acciones        TEXT    NOT NULL,                     -- JSON: [{"set":"categoria_id","valor":12}]
    activa          INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE parametro (                                  -- UVT, usura, SMMLV, TRM
    clave           TEXT    NOT NULL,
    vigencia_desde  TEXT    NOT NULL,
    valor           REAL    NOT NULL,
    fuente          TEXT    NOT NULL,
    PRIMARY KEY (clave, vigencia_desde)
);

CREATE TABLE auditoria (
    id              INTEGER PRIMARY KEY,
    entidad         TEXT    NOT NULL,
    entidad_id      INTEGER NOT NULL,
    accion          TEXT    NOT NULL CHECK (accion IN ('crear','editar','borrar')),
    antes           TEXT,
    despues         TEXT,
    fecha           TEXT    NOT NULL
);

CREATE TABLE cache_agregados (                            -- invalidada por eventos de dominio
    clave           TEXT PRIMARY KEY,
    valor           TEXT NOT NULL,                        -- JSON
    version         INTEGER NOT NULL,
    calculado_en    TEXT NOT NULL
);

-- ---------- Vistas derivadas (nunca se persisten) ----------
CREATE VIEW v_prestamo_saldo AS
SELECT p.id AS prestamo_id, p.direccion, p.contraparte_id, p.estado, p.monto AS capital,
       COALESCE((SELECT SUM(c.interes) FROM prestamo_cuota c WHERE c.prestamo_id = p.id),
                CASE p.tipo_interes WHEN 'fijo' THEN p.interes_fijo ELSE 0 END, 0) AS interes_pactado,
       COALESCE((SELECT SUM(ABS(t.monto)) FROM transaccion t
                 WHERE t.prestamo_id = p.id AND t.estado = 'confirmada'
                   AND ((p.direccion = 'presto_yo' AND t.monto > 0) OR (p.direccion = 'me_prestaron' AND t.monto < 0))), 0) AS abonado,
       (SELECT MIN(c.fecha) FROM prestamo_cuota c WHERE c.prestamo_id = p.id) AS primera_cuota
FROM prestamo_personal p;
-- pendiente = capital + interes_pactado − abonado (se calcula en la consulta de lectura)

CREATE VIEW v_saldo_cuenta AS
SELECT c.id AS cuenta_id, c.nombre,
       c.saldo_inicial + COALESCE(SUM(t.monto), 0) AS saldo
FROM cuenta c
LEFT JOIN transaccion t ON t.cuenta_id = c.id AND t.estado = 'confirmada'
GROUP BY c.id;

CREATE VIEW v_movimiento_mensual AS
SELECT substr(t.fecha, 1, 7) AS mes, cat.grupo, t.categoria_id,
       SUM(t.monto) AS total, COUNT(*) AS n
FROM transaccion t
JOIN categoria cat ON cat.id = t.categoria_id
WHERE t.estado = 'confirmada' AND t.transferencia_id IS NULL
GROUP BY mes, cat.grupo, t.categoria_id;

CREATE VIEW v_presupuesto_mes AS
SELECT p.mes, p.categoria_id, p.asignado,
       -COALESCE((SELECT SUM(m.total) FROM v_movimiento_mensual m
                  WHERE m.mes = p.mes AND m.categoria_id = p.categoria_id), 0) AS gastado,
       p.asignado + COALESCE((SELECT SUM(m.total) FROM v_movimiento_mensual m
                  WHERE m.mes = p.mes AND m.categoria_id = p.categoria_id), 0) AS disponible
FROM presupuesto p;
