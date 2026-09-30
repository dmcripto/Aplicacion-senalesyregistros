import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: {
    alias: {
      // Las funciones del servidor (Deno) importan supabase con este nombre: en las pruebas se usa una base falsa.
      "npm:@supabase/supabase-js@2": fileURLToPath(new URL("./tests/helpers/fake-supabase.ts", import.meta.url)),
    },
  },
});
