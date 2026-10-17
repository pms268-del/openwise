"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MapPoint = { lat: number; lng: number; label: string; kind: "competitor" | "property" | "target"; detail?: string };

/** Google Maps JS when a browser key is configured (with Google attribution built in);
 *  otherwise Leaflet + OpenStreetMap tiles (attribution shown). */
export function MapView({ center, radiusM, points, googleKey }: { center: { lat: number; lng: number }; radiusM: number; points: MapPoint[]; googleKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const dataKey = JSON.stringify([center, radiusM, points]);
  useEffect(() => {
    if (!ref.current) return;
    let cleanup = () => {};
    const colors = { competitor: "#dc2626", property: "#047857", target: "#1d4ed8" };
    if (googleKey) {
      const w = window as unknown as { google?: any; __siqMaps?: Promise<void> };
      w.__siqMaps ??= new Promise<void>((res, rej) => {
        const s = document.createElement("script");
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleKey)}&v=weekly`;
        s.async = true; s.onload = () => res(); s.onerror = rej; document.head.appendChild(s);
      });
      w.__siqMaps.then(() => {
        const g = w.google.maps;
        const map = new g.Map(ref.current, { center, zoom: 15, mapTypeControl: false, streetViewControl: false });
        new g.Circle({ map, center, radius: radiusM, strokeColor: "#1d4ed8", strokeWeight: 1, fillOpacity: 0.05 });
        const info = new g.InfoWindow();
        for (const p of points) {
          const m = new g.Marker({ map, position: p, title: p.label, icon: { path: g.SymbolPath.CIRCLE, scale: p.kind === "target" ? 8 : 6, fillColor: colors[p.kind], fillOpacity: 0.9, strokeColor: "#fff", strokeWeight: 1 } });
          m.addListener("click", () => { info.setContent(`<b>${escapeHtml(p.label)}</b><br/>${escapeHtml(p.detail ?? "")}`); info.open({ map, anchor: m }); });
        }
      });
      return;
    }
    import("leaflet").then((L) => {
      if (!ref.current) return;
      const map = L.map(ref.current).setView([center.lat, center.lng], 15);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
      L.circle([center.lat, center.lng], { radius: radiusM, color: "#1d4ed8", weight: 1, fillOpacity: 0.05 }).addTo(map);
      for (const p of points)
        L.circleMarker([p.lat, p.lng], { radius: p.kind === "target" ? 8 : 6, color: "#fff", weight: 1, fillColor: colors[p.kind], fillOpacity: 0.9 })
          .bindPopup(`<b>${escapeHtml(p.label)}</b><br/>${escapeHtml(p.detail ?? "")}`).addTo(map);
      cleanup = () => map.remove();
    });
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, googleKey]);
  return (
    <div>
      <div ref={ref} className="h-[380px] w-full overflow-hidden rounded-lg border border-stone-200 bg-stone-100" />
      <div className="mt-2 flex gap-4 text-xs text-stone-600">
        <span><span className="inline-block h-2 w-2 rounded-full bg-blue-700" /> Target</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-red-600" /> Competitor</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-700" /> Property lead</span>
        {googleKey ? <span className="ml-auto">Map data © Google</span> : <span className="ml-auto">Tiles © OpenStreetMap contributors</span>}
      </div>
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
