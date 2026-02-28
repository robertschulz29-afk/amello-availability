import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Create Supabase client once (singleton)
 * Uses service role key for server-side access.
 */
const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
}

/**
 * Generic table query helper
 */
export async function getAll<T = any>(table: string) {
  const { data, error } = await supabase.from(table).select("*");

  if (error) {
    throw error;
  }

  return data as T[];
}

/**
 * Generic filtered query helper
 */
export async function getWhere<T = any>(
  table: string,
  column: string,
  value: any
) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(column, value);

  if (error) {
    throw error;
  }

  return data as T[];
}

/**
 * Expose raw client for advanced queries when needed
 */
export function getClient(): SupabaseClient {
  return supabase;
}
