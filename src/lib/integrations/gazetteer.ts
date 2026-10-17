// Approximate NYC neighborhood centroids used ONLY as a geocoding fallback when Google
// Geocoding is not configured. Labeled "approximate" wherever it is used.
export const NYC_NEIGHBORHOODS: { name: string; borough: string; lat: number; lng: number; aliases?: string[] }[] = [
  { name: "Williamsburg", borough: "Brooklyn", lat: 40.7142, lng: -73.9614 },
  { name: "Greenpoint", borough: "Brooklyn", lat: 40.7305, lng: -73.9515 },
  { name: "Bushwick", borough: "Brooklyn", lat: 40.6958, lng: -73.9171 },
  { name: "Park Slope", borough: "Brooklyn", lat: 40.6710, lng: -73.9814 },
  { name: "DUMBO", borough: "Brooklyn", lat: 40.7033, lng: -73.9881 },
  { name: "Brooklyn Heights", borough: "Brooklyn", lat: 40.6960, lng: -73.9950 },
  { name: "Fort Greene", borough: "Brooklyn", lat: 40.6892, lng: -73.9742 },
  { name: "Crown Heights", borough: "Brooklyn", lat: 40.6694, lng: -73.9422 },
  { name: "Bed-Stuy", borough: "Brooklyn", lat: 40.6872, lng: -73.9418, aliases: ["bedford-stuyvesant", "bedford stuyvesant"] },
  { name: "Carroll Gardens", borough: "Brooklyn", lat: 40.6795, lng: -73.9991 },
  { name: "Downtown Brooklyn", borough: "Brooklyn", lat: 40.6928, lng: -73.9903 },
  { name: "East Village", borough: "Manhattan", lat: 40.7265, lng: -73.9815 },
  { name: "West Village", borough: "Manhattan", lat: 40.7358, lng: -74.0036 },
  { name: "Greenwich Village", borough: "Manhattan", lat: 40.7336, lng: -73.9990 },
  { name: "Lower East Side", borough: "Manhattan", lat: 40.7150, lng: -73.9843, aliases: ["les"] },
  { name: "SoHo", borough: "Manhattan", lat: 40.7233, lng: -74.0030 },
  { name: "Tribeca", borough: "Manhattan", lat: 40.7163, lng: -74.0086 },
  { name: "Chelsea", borough: "Manhattan", lat: 40.7465, lng: -74.0014 },
  { name: "Flatiron", borough: "Manhattan", lat: 40.7411, lng: -73.9897 },
  { name: "Midtown", borough: "Manhattan", lat: 40.7549, lng: -73.9840 },
  { name: "Financial District", borough: "Manhattan", lat: 40.7075, lng: -74.0113, aliases: ["fidi"] },
  { name: "Upper West Side", borough: "Manhattan", lat: 40.7870, lng: -73.9754, aliases: ["uws"] },
  { name: "Upper East Side", borough: "Manhattan", lat: 40.7736, lng: -73.9566, aliases: ["ues"] },
  { name: "Harlem", borough: "Manhattan", lat: 40.8116, lng: -73.9465 },
  { name: "Washington Heights", borough: "Manhattan", lat: 40.8417, lng: -73.9394 },
  { name: "Murray Hill", borough: "Manhattan", lat: 40.7479, lng: -73.9757 },
  { name: "Astoria", borough: "Queens", lat: 40.7644, lng: -73.9235 },
  { name: "Long Island City", borough: "Queens", lat: 40.7447, lng: -73.9485, aliases: ["lic"] },
  { name: "Sunnyside", borough: "Queens", lat: 40.7433, lng: -73.9196 },
  { name: "Jackson Heights", borough: "Queens", lat: 40.7557, lng: -73.8831 },
  { name: "Flushing", borough: "Queens", lat: 40.7675, lng: -73.8331 },
  { name: "Forest Hills", borough: "Queens", lat: 40.7181, lng: -73.8448 },
  { name: "Ridgewood", borough: "Queens", lat: 40.7043, lng: -73.9018 },
  { name: "Mott Haven", borough: "Bronx", lat: 40.8091, lng: -73.9229 },
  { name: "Riverdale", borough: "Bronx", lat: 40.8900, lng: -73.9122 },
  { name: "St. George", borough: "Staten Island", lat: 40.6437, lng: -74.0736 },
];

export function lookupNeighborhood(text: string) {
  const t = text.toLowerCase();
  return NYC_NEIGHBORHOODS.find((n) => t.includes(n.name.toLowerCase()) || n.aliases?.some((a) => t.includes(a))) ?? null;
}
