-- Create collector table: each row represents a named group of global types
CREATE TABLE IF NOT EXISTS global_type_collector (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  type_category_id BIGINT REFERENCES global_types_categories(id)
);

-- Seed collectors from the distinct type_name + type_category combinations in global_types
INSERT INTO global_type_collector (name, type_category_id)
SELECT DISTINCT
  gt.type_name,
  CASE WHEN gt.type_category IS NOT NULL AND gt.type_category ~ '^\d+$'
       THEN gt.type_category::bigint
       ELSE NULL END
FROM global_types gt
WHERE gt.type_name IS NOT NULL;

-- Add the FK from global_types to the collector
ALTER TABLE global_types
  ADD COLUMN IF NOT EXISTS group_id BIGINT REFERENCES global_type_collector(id);

-- Map each existing row: match collector by name (type_name)
UPDATE global_types gt
SET group_id = gc.id
FROM global_type_collector gc
WHERE gt.type_name = gc.name;

-- Drop columns now represented by the collector FK
ALTER TABLE global_types
  DROP COLUMN IF EXISTS type_name,
  DROP COLUMN IF EXISTS type_category,
  DROP COLUMN IF EXISTS group_name;
