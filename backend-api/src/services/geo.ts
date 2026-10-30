const R = Math.PI / 180;

/** Great-circle distance in km between two [lat, lng] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const dLa = (b[0] - a[0]) * R, dLo = (b[1] - a[1]) * R;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(dLo / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Standard geohash (SRS 6.1 stores 7 characters; Kafka keys use the first 4). */
export function geohashEncode(lat: number, lng: number, precision = 7): string {
  let latR: [number, number] = [-90, 90], lngR: [number, number] = [-180, 180];
  let hash = "", bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    const r = even ? lngR : latR, v = even ? lng : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch = ch << 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}
