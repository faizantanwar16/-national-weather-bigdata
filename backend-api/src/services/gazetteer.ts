import { haversineKm } from "./geo";

// Small offline gazetteer of Indian places (SRS FR-ING-06). Extend this list or swap in a CSV later.
export const CITIES: [string, string, number, number][] = [
  ["Wardha", "Maharashtra", 20.7453, 78.6022], ["Nagpur", "Maharashtra", 21.1458, 79.0882], ["Mumbai", "Maharashtra", 19.076, 72.8777], ["Pune", "Maharashtra", 18.5204, 73.8567],
  ["Nashik", "Maharashtra", 19.9975, 73.7898], ["Aurangabad", "Maharashtra", 19.8762, 75.3433], ["Amravati", "Maharashtra", 20.9374, 77.7796],
  ["Delhi", "Delhi", 28.6139, 77.209], ["New Delhi", "Delhi", 28.6139, 77.209], ["Chandigarh", "Chandigarh", 30.7333, 76.7794], ["Jaipur", "Rajasthan", 26.9124, 75.7873], ["Jodhpur", "Rajasthan", 26.2389, 73.0243],
  ["Lucknow", "Uttar Pradesh", 26.8467, 80.9462], ["Varanasi", "Uttar Pradesh", 25.3176, 82.9739], ["Kanpur", "Uttar Pradesh", 26.4499, 80.3319], ["Patna", "Bihar", 25.5941, 85.1376],
  ["Kolkata", "West Bengal", 22.5726, 88.3639], ["Bhubaneswar", "Odisha", 20.2961, 85.8245], ["Guwahati", "Assam", 26.1445, 91.7362], ["Imphal", "Manipur", 24.817, 93.9368],
  ["Ranchi", "Jharkhand", 23.3441, 85.3096], ["Raipur", "Chhattisgarh", 21.2514, 81.6296], ["Bhopal", "Madhya Pradesh", 23.2599, 77.4126], ["Indore", "Madhya Pradesh", 22.7196, 75.8577],
  ["Ahmedabad", "Gujarat", 23.0225, 72.5714], ["Surat", "Gujarat", 21.1702, 72.8311], ["Hyderabad", "Telangana", 17.385, 78.4867], ["Visakhapatnam", "Andhra Pradesh", 17.6868, 83.2185],
  ["Chennai", "Tamil Nadu", 13.0827, 80.2707], ["Coimbatore", "Tamil Nadu", 11.0168, 76.9558], ["Bengaluru", "Karnataka", 12.9716, 77.5946], ["Mangaluru", "Karnataka", 12.9141, 74.856],
  ["Kochi", "Kerala", 9.9312, 76.2673], ["Thiruvananthapuram", "Kerala", 8.5241, 76.9366], ["Panaji", "Goa", 15.4909, 73.8278], ["Dehradun", "Uttarakhand", 30.3165, 78.0322],
  ["Shimla", "Himachal Pradesh", 31.1048, 77.1734], ["Srinagar", "Jammu & Kashmir", 34.0837, 74.7973], ["Amritsar", "Punjab", 31.634, 74.8723],
];

export interface Place { lat: number; lng: number; city?: string; state?: string; precision: "city" | "state" }

/** Resolve free-text city/state to coordinates. Returns null when nothing matches. */
export function resolvePlace(city?: string, state?: string): Place | null {
  const c = city?.trim().toLowerCase(), s = state?.trim().toLowerCase();
  if (c) {
    const hit = CITIES.find((x) => x[0].toLowerCase() === c && (!s || x[1].toLowerCase() === s)) ?? CITIES.find((x) => x[0].toLowerCase() === c);
    if (hit) return { lat: hit[2], lng: hit[3], city: hit[0], state: hit[1], precision: "city" };
  }
  if (s) {
    const inState = CITIES.filter((x) => x[1].toLowerCase() === s);
    if (inState.length) {
      const lat = inState.reduce((a, x) => a + x[2], 0) / inState.length, lng = inState.reduce((a, x) => a + x[3], 0) / inState.length;
      return { lat, lng, city: city?.trim() || undefined, state: inState[0][1], precision: "state" };
    }
  }
  return null;
}

export function nearestCity(lat: number, lng: number) {
  const best = CITIES.reduce((b, x) => (haversineKm([lat, lng], [x[2], x[3]]) < haversineKm([lat, lng], [b[2], b[3]]) ? x : b));
  return { city: best[0], state: best[1], distanceKm: haversineKm([lat, lng], [best[2], best[3]]) };
}
