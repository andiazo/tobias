-- M6 - El bloque de evaluacion ergonomica del reporte. El Google Form vive
-- fuera del sistema, asi que los conteos los actualiza el operador del piloto.
ALTER TABLE empresas ADD COLUMN form_enviados INTEGER NOT NULL DEFAULT 0;
ALTER TABLE empresas ADD COLUMN form_respuestas INTEGER NOT NULL DEFAULT 0;
