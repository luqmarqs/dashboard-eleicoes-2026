import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import { useQuery } from "@tanstack/react-query";
import { latLngToCell } from "h3-js";
import { useMemo, useRef } from "react";
import MapGL, { Marker, NavigationControl, useControl, type MapRef } from "react-map-gl/maplibre";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { corSequencial, cssRgb, prefersDark, quantis, ramp } from "../lib/colors";
import type { Base, PorLocal } from "../lib/data";
import { fmt, pct, titulo } from "../lib/format";
import { geoUrl } from "../lib/source";

import type { CorPorLocal, Destaque, Metrica, Modo } from "./mapTypes";

interface Props {
  base: Base;
  dados: PorLocal | undefined;
  municipio: string | null;
  modo: Modo;
  metrica: Metrica;
  destaques?: Destaque[];
  corPorLocal?: CorPorLocal;
  rotuloSerie?: string;
  onMunicipio?: (cd: string) => void;
  altura?: string;
}

function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const STYLE_LIGHT = "https://tiles.openfreemap.org/styles/positron";
const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
const SP_BOUNDS: [[number, number], [number, number]] = [[-53.2, -25.4], [-44.1, -19.7]];

type Geo = FeatureCollection<Geometry, Record<string, unknown>>;

export function MapView({
  base, dados, municipio, modo, metrica, destaques = [], corPorLocal, rotuloSerie = "votos", onMunicipio,
  altura = "min(70vh, 720px)",
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const dark = prefersDark();
  const mun = municipio ? base.munByCd.get(municipio) : undefined;

  const municipiosGeo = useQuery({
    queryKey: ["geo", "municipios", base.municipios[0]?.cd],
    queryFn: async () => (await fetch(geoUrl.municipios())).json() as Promise<Geo>,
    staleTime: Infinity,
  });
  const territoriosGeo = useQuery({
    queryKey: ["geo", "territorios", mun?.ibge],
    queryFn: async () => (await fetch(geoUrl.territorios(mun!.ibge))).json() as Promise<Geo>,
    enabled: modo === "territorios" && !!mun,
    staleTime: Infinity,
  });

  const noEscopo = useMemo(
    () => base.locais.filter((l) => !municipio || l.mun === municipio),
    [base, municipio],
  );

  // Enquadramento do escopo (estado ou município): o mapa é recriado já enquadrado quando o
  // escopo muda (key abaixo), o que é mais previsível do que animar depois do carregamento.
  const bounds = useMemo<[[number, number], [number, number]]>(() => {
    let [minX, minY, maxX, maxY] = [180, 90, -180, -90];
    for (const l of noEscopo) {
      if (l.aprox) continue;
      minX = Math.min(minX, l.lon); maxX = Math.max(maxX, l.lon);
      minY = Math.min(minY, l.lat); maxY = Math.max(maxY, l.lat);
    }
    return minX <= maxX ? [[minX, minY], [maxX, maxY]] : SP_BOUNDS; // SP_BOUNDS só como último recurso
  }, [municipio, noEscopo]);

  const metricaDe = (v: number, val: number) => (metrica === "pct" ? (val ? v / val : 0) : v);

  const { layers, breaks } = useMemo(() => {
    const layers: Layer[] = [];
    let breaks: number[] = [];
    if (!dados) return { layers, breaks };
    const efetivo: Modo = modo === "territorios" && !mun ? "municipios" : modo;

    if (efetivo === "escolas") {
      const pts = noEscopo.filter((l) => dados.votos[l.idx] > 0);
      breaks = quantis(pts.map((l) => metricaDe(dados.votos[l.idx], dados.validos[l.idx])));
      const vmax = Math.max(1, ...pts.map((l) => dados.votos[l.idx]));
      layers.push(new ScatterplotLayer({
        id: "escolas", data: pts, pickable: true, radiusUnits: "pixels", stroked: true, lineWidthUnits: "pixels",
        getPosition: (l) => [l.lon, l.lat],
        getRadius: (l) => 2.5 + 15 * Math.sqrt(dados.votos[l.idx] / vmax),
        getFillColor: (l) => {
          const c = corPorLocal?.(l.idx);
          return c ? [...c, 235] : corSequencial(metricaDe(dados.votos[l.idx], dados.validos[l.idx]), breaks);
        },
        getLineColor: dark ? [21, 17, 26, 200] : [255, 255, 255, 220],
        getLineWidth: 1,
        updateTriggers: { getFillColor: [metrica, breaks, corPorLocal], getRadius: [vmax] },
      }));
    }

    if (efetivo === "territorios" && territoriosGeo.data) {
      const valor = (f: Feature) => {
        let v = 0, val = 0, idx = -1;
        for (const id of (f.properties?.locais as number[]) ?? []) {
          const l = base.localById.get(id);
          if (l) { v += dados.votos[l.idx]; val += dados.validos[l.idx]; idx = l.idx; }
        }
        return { v, val, idx };
      };
      breaks = quantis(territoriosGeo.data.features.map((f) => { const x = valor(f); return metricaDe(x.v, x.val); }));
      layers.push(new GeoJsonLayer({
        id: "territorios", data: territoriosGeo.data, pickable: true, stroked: true, filled: true,
        getFillColor: (f) => {
          const x = valor(f as Feature);
          const c = corPorLocal && x.idx >= 0 ? corPorLocal(x.idx) : null;
          return c ? [...c, 215] : corSequencial(metricaDe(x.v, x.val), breaks, 200);
        },
        getLineColor: dark ? [21, 17, 26, 160] : [255, 255, 255, 200],
        lineWidthUnits: "pixels", getLineWidth: 0.6,
        updateTriggers: { getFillColor: [metrica, breaks, dados, corPorLocal] },
      }));
    }

    if (efetivo === "municipios" && municipiosGeo.data) {
      const agg = new Map<string, { v: number; val: number }>();
      for (const l of base.locais) {
        const a = agg.get(l.mun) ?? { v: 0, val: 0 };
        a.v += dados.votos[l.idx]; a.val += dados.validos[l.idx];
        agg.set(l.mun, a);
      }
      breaks = quantis([...agg.values()].map((a) => metricaDe(a.v, a.val)));
      layers.push(new GeoJsonLayer({
        id: "municipios", data: municipiosGeo.data, pickable: true, stroked: true, filled: true,
        getFillColor: (f) => {
          const a = agg.get(String(f.properties?.cd_municipio));
          return a ? corSequencial(metricaDe(a.v, a.val), breaks, 215) : [0, 0, 0, 0];
        },
        getLineColor: dark ? [21, 17, 26, 180] : [255, 255, 255, 220],
        lineWidthUnits: "pixels", getLineWidth: 0.5,
        onClick: (info) => { const cd = info.object?.properties?.cd_municipio; if (cd && onMunicipio) onMunicipio(cd); },
        updateTriggers: { getFillColor: [metrica, breaks, dados] },
      }));
    }

    if (efetivo === "hexagonos") {
      const res = municipio ? 8 : 6;
      const cells = new Map<string, { v: number; val: number }>();
      for (const l of noEscopo) {
        const h = latLngToCell(l.lat, l.lon, res);
        const c = cells.get(h) ?? { v: 0, val: 0 };
        c.v += dados.votos[l.idx]; c.val += dados.validos[l.idx];
        cells.set(h, c);
      }
      const data = [...cells.entries()].filter(([, c]) => c.v > 0).map(([hex, c]) => ({ hex, ...c }));
      breaks = quantis(data.map((d) => metricaDe(d.v, d.val)));
      layers.push(new H3HexagonLayer({
        id: "hex", data, pickable: true, filled: true, extruded: false, stroked: true,
        getHexagon: (d) => d.hex, getFillColor: (d) => corSequencial(metricaDe(d.v, d.val), breaks, 210),
        getLineColor: dark ? [21, 17, 26, 120] : [255, 255, 255, 160], lineWidthUnits: "pixels", getLineWidth: 0.5,
        updateTriggers: { getFillColor: [metrica, breaks] },
      }));
    }

    if (efetivo === "calor") {
      const pts = noEscopo.filter((l) => dados.votos[l.idx] > 0);
      layers.push(new HeatmapLayer({
        id: "calor", data: pts, getPosition: (l) => [l.lon, l.lat], getWeight: (l) => dados.votos[l.idx],
        radiusPixels: municipio ? 22 : 16, intensity: 1, threshold: 0.04, aggregation: "SUM",
        colorRange: ramp().slice(1),
      }));
    }

    if (mun && municipiosGeo.data) {
      const f = municipiosGeo.data.features.find((x) => x.properties?.cd_municipio === mun.cd);
      if (f) {
        layers.push(new GeoJsonLayer({
          id: "contorno", data: [f], stroked: true, filled: false, lineWidthUnits: "pixels", getLineWidth: 2,
          getLineColor: dark ? [211, 156, 240, 230] : [123, 31, 162, 230],
        }));
      }
    }
    return { layers, breaks };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, modo, metrica, municipio, noEscopo, territoriosGeo.data, municipiosGeo.data, corPorLocal, dark]);

  const getTooltip = ({ object, layer }: PickingInfo) => {
    if (!object || !dados || !layer) return null;
    let titulo_ = "", sub = "", v = 0, val = 0;
    if (layer.id === "escolas") {
      const l = object as Base["locais"][number];
      titulo_ = l.nome; sub = `${titulo(l.bairro)} · ${titulo(l.munNome)} · zona ${l.zona}`;
      v = dados.votos[l.idx]; val = dados.validos[l.idx];
    } else if (layer.id === "territorios") {
      const ids = (object as Feature).properties?.locais as number[];
      const ls = ids.map((id) => base.localById.get(id)!).filter(Boolean);
      titulo_ = ls.map((l) => l.nome).join(" / "); sub = ls[0] ? titulo(ls[0].bairro) : "";
      for (const l of ls) { v += dados.votos[l.idx]; val += dados.validos[l.idx]; }
    } else if (layer.id === "municipios") {
      const cd = (object as Feature).properties?.cd_municipio as string;
      titulo_ = titulo(base.munByCd.get(cd)?.nome ?? ""); sub = "clique para ver o município";
      for (const l of base.locais) if (l.mun === cd) { v += dados.votos[l.idx]; val += dados.validos[l.idx]; }
    } else if (layer.id === "hex") {
      const d = object as { v: number; val: number };
      titulo_ = "Hexágono"; v = d.v; val = d.val;
    } else return null;
    return {
      html: `<div style="font-weight:700;margin-bottom:2px">${titulo_}</div>` +
        (sub ? `<div style="opacity:.75;font-size:12px">${sub}</div>` : "") +
        `<div style="margin-top:4px">${fmt(v)} ${rotuloSerie} · ${val ? pct(v / val) : "–"} dos válidos</div>`,
      style: {
        background: dark ? "#1f1826" : "#ffffff", color: dark ? "#f1eaf4" : "#241a2b", fontSize: "13px",
        border: `1px solid ${dark ? "#342a3c" : "#e4dce8"}`, borderRadius: "6px", padding: "8px 10px", maxWidth: "320px",
      },
    };
  };

  const r = ramp();
  const fmtBreak = (b: number) => (metrica === "pct" ? pct(b, 1) : fmt(b));

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-lg border border-line" style={{ height: altura }}>
        <MapGL
          ref={mapRef}
          key={`${base.municipios[0]?.cd}-${municipio ?? "estado"}`}
          initialViewState={{ bounds, fitBoundsOptions: { padding: municipio ? 40 : 20, maxZoom: 14 } }}
          mapStyle={dark ? STYLE_DARK : STYLE_LIGHT}
          attributionControl={{ compact: true, customAttribution: "Votos: TSE · Limites: IBGE" }}
          style={{ width: "100%", height: "100%" }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <DeckOverlay interleaved layers={layers} getTooltip={getTooltip} />
          {destaques.map((d) => (
            <Marker key={`${d.rank}-${d.nome}`} longitude={d.lon} latitude={d.lat} anchor="center">
              <div
                title={`${d.rank}. ${d.nome}`}
                className={`grid place-items-center rounded-full font-mono font-semibold shadow ${
                  d.rank <= 3 ? "h-7 w-7 bg-accent text-panel text-xs" : "h-6 w-6 bg-ink text-panel text-[11px]"
                }`}
                style={{ boxShadow: "0 0 0 2px var(--panel)" }}
              >
                {d.rank}
              </div>
            </Marker>
          ))}
        </MapGL>
      </div>
      {!corPorLocal && modo !== "calor" && breaks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" aria-label="Legenda">
          <span>{metrica === "pct" ? "% dos válidos" : "votos"}:</span>
          <div className="flex items-center">
            {r.map((c, i) => (
              <div key={i} className="flex flex-col items-center">
                <span className="h-3 w-9" style={{ background: cssRgb(c) }} />
                <span className="num mt-0.5 text-[10px]">{i === 0 ? "" : fmtBreak(breaks[i - 1] ?? breaks[breaks.length - 1])}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
