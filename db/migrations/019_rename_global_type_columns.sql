ALTER TABLE global_types
  RENAME COLUMN type_description TO type_name;

ALTER TABLE global_types
  RENAME COLUMN filter_group TO group_name;
