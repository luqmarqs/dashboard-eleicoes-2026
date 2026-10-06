import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // dev-data/ só existe localmente (gitignored) e é servido pelo servidor de desenvolvimento;
  // nunca entra no build publicado.
  server: { port: 5173 },
  build: {
    // maplibre + deck.gl ficam no chunk do MapView, carregado sob demanda (components/LazyMap.tsx)
    chunkSizeWarningLimit: 2500,
  },
});
