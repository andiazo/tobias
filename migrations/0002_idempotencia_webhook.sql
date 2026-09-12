-- Kapso/Meta reintentan el webhook. Un wamid ya procesado no se vuelve a actuar.
CREATE TABLE mensajes_procesados (
  wamid      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
