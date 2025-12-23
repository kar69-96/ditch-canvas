import { supabase } from "./supabase";

const bucket = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || "user-data";

export async function downloadJson(path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw error || new Error("Failed to download file");
  const text = await data.text();
  return JSON.parse(text);
}

export async function uploadJson(path: string, payload: unknown) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType: "application/json", upsert: true });
  if (error) throw error;
  return true;
}





