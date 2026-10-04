import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: {
    alias: {
      // Las funciones del servidor (Deno) importan supabase con este nombre: en las pruebas se usa una base falsa.
      // El dibujo de las imágenes tarjeta usa resvg (WebAssembly): en las pruebas se usa el mismo paquete desde node_modules.
      "npm:@resvg/resvg-wasm@2.6.2": fileURLToPath(new URL("./node_modules/@resvg/resvg-wasm/index.mjs", import.meta.url)),
      "npm:@supabase/supabase-js@2": fileURLToPath(new URL("./tests/helpers/fake-supabase.ts", import.meta.url)),
    },
  },
});
