-- Grant execute permissions on functions to anon and authenticated roles
-- This allows the frontend to call these functions

GRANT EXECUTE ON FUNCTION get_user_table_prefix(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_user_data_table(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_user_entities(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_user_entity(TEXT, TEXT, TEXT, JSONB, TEXT, JSONB, TEXT, BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_file_storage_path(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION generate_file_storage_path(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_jsonb_index(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO anon, authenticated;


