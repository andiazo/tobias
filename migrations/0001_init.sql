-- M0 - Modelo de datos del MVP de pausas activas.
-- Fechas: texto ISO-8601 en UTC. payload: TEXT con JSON.

CREATE TABLE empresas (
  id                 TEXT PRIMARY KEY,
  nombre             TEXT NOT NULL,
  nit                TEXT,
  tz                 TEXT NOT NULL DEFAULT 'America/Bogota',
  -- JSON: ["10:00","14:30","16:30"] en hora local de la empresa.
  horarios           TEXT NOT NULL DEFAULT '["10:00","14:30","16:30"]',
  reporte_token      TEXT NOT NULL UNIQUE,
  form_ergonomia_url TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE empleados (
  id                    TEXT PRIMARY KEY,
  empresa_id            TEXT NOT NULL REFERENCES empresas(id),
  nombre                TEXT NOT NULL,
  cedula                TEXT,
  telefono_e164         TEXT NOT NULL UNIQUE,
  area                  TEXT,
  consentimiento_at     TEXT,
  baja_at               TEXT,
  -- Cierre de la ventana de servicio de 24 h. Mientras este en el futuro
  -- podemos mandar mensajes libres en vez de plantillas.
  ventana_abierta_hasta TEXT,
  optin_enviado_at      TEXT,
  created_at            TEXT NOT NULL
);

CREATE TABLE pausas (
  id            TEXT PRIMARY KEY,
  empleado_id   TEXT NOT NULL REFERENCES empleados(id),
  -- Desnormalizado a proposito: el reporte agrega sin join contra empleados.
  empresa_id    TEXT NOT NULL REFERENCES empresas(id),
  fecha         TEXT NOT NULL,   -- YYYY-MM-DD en hora local de la empresa
  bloque        INTEGER NOT NULL,-- indice del horario del dia: 0, 1, 2
  programada_at TEXT NOT NULL,
  enviada_at    TEXT,
  estado        TEXT NOT NULL,   -- programada|enviada|pospuesta|iniciada|completada|no_realizada
  confirmada_at TEXT,            -- toco el boton "Ya la hice"
  iniciada_at   TEXT,            -- abrio /p/:token
  completada_at TEXT,            -- termino el cronometro del ejercicio 6
  canal_envio   TEXT             -- plantilla|libre
);

CREATE TABLE molestias (
  id          TEXT PRIMARY KEY,
  pausa_id    TEXT REFERENCES pausas(id),
  empleado_id TEXT NOT NULL REFERENCES empleados(id),
  zona        TEXT NOT NULL,
  comentario  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE eventos (
  id          TEXT PRIMARY KEY,
  empleado_id TEXT REFERENCES empleados(id),
  tipo        TEXT NOT NULL,
  payload     TEXT,
  created_at  TEXT NOT NULL
);

-- D1 cobra por filas escaneadas, no por query.
CREATE UNIQUE INDEX ux_pausa ON pausas(empleado_id, fecha, bloque);
CREATE INDEX ix_pausas_reporte ON pausas(empresa_id, fecha);
CREATE INDEX ix_pausas_pendientes ON pausas(estado, programada_at);
CREATE INDEX ix_empleados_activos ON empleados(empresa_id, consentimiento_at, baja_at);
