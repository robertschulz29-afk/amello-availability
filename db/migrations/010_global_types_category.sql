-- Migration 010: add category and name columns to global_types table

ALTER TABLE "globalTypes"
  ADD COLUMN IF NOT EXISTS type_category VARCHAR(100);
