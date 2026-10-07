import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { UfProvider } from "./lib/uf";
import { LangProvider } from "./lib/i18n";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

// Depois de um deploy, uma aba aberta ainda aponta para chunks antigos (ex.: o do mapa, carregado sob demanda);
// quando o chunk some, o Vite avisa aqui e a página se recarrega uma vez em vez de ficar com o mapa quebrado.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  const k = "recarga-chunk";
  if (sessionStorage.getItem(k) !== location.href) {
    sessionStorage.setItem(k, location.href);
    location.reload();
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LangProvider>
      <UfProvider>
        <App />
      </UfProvider>
      </LangProvider>
    </QueryClientProvider>
  </StrictMode>,
);
