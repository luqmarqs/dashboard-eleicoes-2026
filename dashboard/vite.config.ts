import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // dev-data/ só existe localmente (gitignored) e é servido pelo servidor de desenvolvimento;
  // nunca entra no build publicado.
  server: { port: 5173 },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("maplibre-gl") || id.includes("react-map-gl")) return "map";
          if (id.includes("@deck.gl") || id.includes("@luma.gl") || id.includes("@loaders.gl") || id.includes("h3-js")) return "deck";
          return undefined;
        },
      },
    },
  },
});
