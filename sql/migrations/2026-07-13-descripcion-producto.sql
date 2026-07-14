-- Migración: descripción corta de producto (ej. medidas). Venía en el excel de
-- importación inicial (columna "Descripción") pero el import sólo guardaba nombre
-- y cantidad; se perdía. Aditiva e idempotente. Correr una vez en el SQL Editor.

alter table productos add column if not exists descripcion text;
