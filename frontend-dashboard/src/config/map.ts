/**
 * Shared map configuration.
 *
 * CARTO basemaps now require an API key and show "API KEY REQUIRED" watermarks
 * when accessed without a key.
 * By default, we use Esri World Dark Gray Base (open, fast, zero watermark).
 * If you have a CARTO key, set VITE_CARTO_KEY in frontend-dashboard/.env.
 * Or provide a custom tile URL with VITE_MAP_TILES.
 */
export const MAP_TILES =
  import.meta.env.VITE_NO_TILES === "1"
    ? null
    : import.meta.env.VITE_MAP_TILES ||
      (import.meta.env.VITE_CARTO_KEY
        ? `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${import.meta.env.VITE_CARTO_KEY}`
        : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}");

export const MAP_ATTRIBUTION = import.meta.env.VITE_CARTO_KEY
  ? "&copy; OpenStreetMap contributors, &copy; CARTO"
  : "&copy; Esri, OpenStreetMap contributors";

export const MAP_SUBDOMAINS = import.meta.env.VITE_CARTO_KEY ? "abcd" : "";
