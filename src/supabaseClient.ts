import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copiá .env.example a .env y completá los valores de tu proyecto Supabase.",
  );
}

export const supabase = createClient(url, anonKey);
