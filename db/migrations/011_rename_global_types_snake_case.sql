-- Migration 011: rename globalTypes table and columns to snake_case

ALTER TABLE "globalTypes" RENAME TO global_types;
ALTER TABLE global_types RENAME COLUMN "globalType" TO global_type;
ALTER TABLE hotels RENAME COLUMN "globalTypes" TO global_types;
