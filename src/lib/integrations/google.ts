// Google Maps Platform adapters (Geocoding API + Places API (New) Nearby Search).
// Terms respected: only place_id is persisted long-term; Places content is cached <= 30 days
// in data_cache and displayed with "Powered by Google" attribution when live.
import { env, integrations } from "../env";
import { cached, hashKey, haversineM, seeded } from "./cache";
import { lookupNeighborhood } from "./gazetteer";

export type Geo = { lat: number; lng: number; formattedAddress: string; borough?: string; approximate: boolean };
export type Competitor = {
  placeId: string; name: string; lat: number; lng: number; rating: number | null;
  userRatingCount: number | null; priceLevel: string | null; distanceM: number; isMock: boolean;
};

const PLACES_LICENSE = "Google Maps Platform: place content cached ≤30 days; place_id retained; attribution required.";

export async function geocode(address: string, engagementId?: string) {
  return cached<Geo | null>({
    key: "geocode:" + hashKey(address.toLowerCase().trim()),
    source: "google_geocoding",
    ttlDays: 30,
    engagementId,
    license: PLACES_LICENSE,
    live: integrations.googleMaps()
      ? async () => {
          const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
          u.searchParams.set("address", address);
          u.searchParams.set("bounds", "40.4774,-74.2591|40.9176,-73.7004");
          u.searchParams.set("key", env.googleServerKey);
          const r = await fetch(u, { cache: "no-store" });
          const j = await r.json();
          if (j.status !== "OK") throw new Error(`Geocoding ${j.status}`);
          const res = j.results[0];
          const borough = res.address_components.find((c: { types: string[] }) => c.types.includes("sublocality_level_1"))?.long_name;
          return { lat: res.geometry.location.lat, lng: res.geometry.location.lng, formattedAddress: res.formatted_address, borough, approximate: false };
        }
      : null,
    mock: () => {
      const n = lookupNeighborhood(address);
      return n ? { lat: n.lat, lng: n.lng, formattedAddress: `${n.name}, ${n.borough}, NY (approximate centroid)`, borough: n.borough, approximate: true } : null;
    },
  });
}

export async function nearbyCompetitors(
  center: { lat: number; lng: number }, radiusM: number, placeTypes: string[], engagementId?: string,
) {
  const key = "places:" + hashKey([center.lat.toFixed(4), center.lng.toFixed(4), radiusM, placeTypes]);
  return cached<Competitor[]>({
    key, source: "google_places", ttlDays: 30, engagementId, license: PLACES_LICENSE,
    live: integrations.googleMaps()
      ? async () => {
          const r = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": env.googleServerKey,
              "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.businessStatus",
            },
            body: JSON.stringify({
              includedTypes: placeTypes,
              maxResultCount: 20,
              rankPreference: "DISTANCE",
              locationRestriction: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: radiusM } },
            }),
            cache: "no-store",
          });
          if (!r.ok) throw new Error(`Places ${r.status}: ${(await r.text()).slice(0, 200)}`);
          const j = await r.json();
          type P = { id: string; displayName?: { text: string }; location: { latitude: number; longitude: number }; rating?: number; userRatingCount?: number; priceLevel?: string; businessStatus?: string };
          return ((j.places ?? []) as P[])
            .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
            .map((p) => ({
              placeId: p.id, name: p.displayName?.text ?? "Unnamed", lat: p.location.latitude, lng: p.location.longitude,
              rating: p.rating ?? null, userRatingCount: p.userRatingCount ?? null, priceLevel: p.priceLevel ?? null,
              distanceM: haversineM(center, { lat: p.location.latitude, lng: p.location.longitude }), isMock: false,
            }));
        }
      : null,
    mock: () => {
      const rnd = seeded(key);
      const n = 6 + Math.floor(rnd() * 14);
      return Array.from({ length: n }, (_, i) => {
        const ang = rnd() * 2 * Math.PI, d = Math.sqrt(rnd()) * radiusM;
        const lat = center.lat + (d * Math.cos(ang)) / 111320;
        const lng = center.lng + (d * Math.sin(ang)) / (111320 * Math.cos((center.lat * Math.PI) / 180));
        return {
          placeId: `mock_${key.slice(7, 15)}_${i}`, name: `[MOCK] Café ${String.fromCharCode(65 + i)}`, lat, lng,
          rating: Math.round((3.6 + rnd() * 1.3) * 10) / 10, userRatingCount: Math.floor(20 + rnd() * 900),
          priceLevel: null, distanceM: Math.round(d), isMock: true,
        };
      }).sort((a, b) => a.distanceM - b.distanceM);
    },
  });
}
