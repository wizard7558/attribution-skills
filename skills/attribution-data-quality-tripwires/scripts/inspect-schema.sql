-- Read-only metadata extraction. Supply all five named query parameters.
-- No source row values are selected. All created tables/functions are temporary.
DECLARE target_project STRING DEFAULT @project;
DECLARE target_dataset STRING DEFAULT @dataset;
DECLARE origin_system STRING DEFAULT @source_system;
DECLARE origin_scope STRING DEFAULT @source_scope;
DECLARE requested_tables ARRAY<STRING> DEFAULT @table_keys;
CREATE TEMP FUNCTION valid_key(v STRING) AS (v IS NOT NULL AND v!='' AND v=TRIM(v) AND NOT REGEXP_CONTAINS(v,r'[\x{0000}-\x{001F}\x{007F}-\x{009F}]'));
ASSERT target_project IS NOT NULL AND REGEXP_CONTAINS(target_project,r'^[a-z][a-z0-9-]{4,61}[a-z0-9]$')
 AND target_dataset IS NOT NULL AND LENGTH(target_dataset)<=1024 AND REGEXP_CONTAINS(target_dataset,r'^[A-Za-z_][A-Za-z0-9_]*$') AS 'invalid metadata identifiers';
ASSERT valid_key(origin_system) AND valid_key(origin_scope) AS 'invalid source identity';
ASSERT requested_tables IS NOT NULL AND ARRAY_LENGTH(requested_tables)>0
 AND NOT EXISTS(SELECT 1 FROM UNNEST(requested_tables) t WHERE t IS NULL OR LENGTH(t)>1024 OR NOT REGEXP_CONTAINS(t,r'^[A-Za-z_][A-Za-z0-9_]*$')) AS 'invalid requested tables';
CREATE OR REPLACE TEMP TABLE requested AS SELECT DISTINCT table_key FROM UNNEST(requested_tables) table_key;
EXECUTE IMMEDIATE FORMAT("""
 CREATE TEMP TABLE observed_tables AS SELECT table_name FROM `%s.%s.INFORMATION_SCHEMA.TABLES`
 WHERE table_name IN UNNEST(@table_names)
""",target_project,target_dataset) USING requested_tables AS table_names;
EXECUTE IMMEDIATE FORMAT("""
 CREATE TEMP TABLE observed_columns AS
 SELECT table_name,column_name AS field_path,data_type FROM `%s.%s.INFORMATION_SCHEMA.COLUMNS`
 WHERE table_name IN UNNEST(@table_names)
 UNION DISTINCT
 SELECT table_name,field_path,data_type FROM `%s.%s.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
 WHERE table_name IN UNNEST(@table_names)
""",target_project,target_dataset,target_project,target_dataset) USING requested_tables AS table_names;
ASSERT NOT EXISTS(SELECT table_name,field_path FROM observed_columns GROUP BY 1,2 HAVING COUNT(DISTINCT data_type)>1) AS 'conflicting extracted metadata';
-- The full metadata query must succeed before schema_complete=true is emitted.
SELECT TO_JSON_STRING(STRUCT(origin_system AS source_system,origin_scope AS source_scope,target_project AS project,target_dataset AS dataset,
 ARRAY(SELECT table_key FROM requested ORDER BY table_key) AS table_keys,
 ARRAY(SELECT AS STRUCT origin_system AS source_system,origin_scope AS source_scope,r.table_key,TRUE AS schema_complete,o.table_name IS NOT NULL AS table_exists
 FROM requested r LEFT JOIN observed_tables o ON r.table_key=o.table_name ORDER BY table_key) AS membership,
 ARRAY(SELECT AS STRUCT origin_system AS source_system,origin_scope AS source_scope,table_name AS table_key,field_path,data_type FROM observed_columns ORDER BY table_name,field_path) AS columns
)) AS result_json;
