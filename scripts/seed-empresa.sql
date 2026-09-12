-- Empresa del piloto. Ajusta nombre, nit y horarios antes de correrlo.
-- El reporte_token queda fijo aqui a proposito para no perderlo;
-- en produccion usa POST /admin/empresa, que genera uno aleatorio.
INSERT INTO empresas (id, nombre, nit, tz, horarios, reporte_token, form_ergonomia_url, created_at)
VALUES (
  'empresa-piloto',
  'Empresa Piloto SAS',
  '900000000-0',
  'America/Bogota',
  '["10:00","14:30","16:30"]',
  'cambia-este-token-por-uno-aleatorio',
  NULL,
  datetime('now')
)
ON CONFLICT DO NOTHING;
