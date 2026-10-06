import { lazy, Suspense, type ComponentProps } from "react";

// O mapa (maplibre + deck.gl, ~2 MB) carrega em paralelo: ranking e tabelas aparecem antes dele.
const MapView = lazy(() => import("./MapView").then((m) => ({ default: m.MapView })));

export function LazyMap(props: ComponentProps<typeof MapView>) {
  return (
    <Suspense fallback={
      <div className="grid place-items-center rounded-lg border border-line bg-panel text-muted"
        style={{ height: props.altura ?? "min(70vh, 720px)" }}>Carregando mapa…</div>
    }>
      <MapView {...props} />
    </Suspense>
  );
}
