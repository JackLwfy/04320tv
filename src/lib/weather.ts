export type WeatherCity = { name: string; region: string; country: string; lat: number; lon: number };
export type WeatherReading = { temp: number; text: string; code: string; kind: 'rain' | 'snow' | 'none'; fetchedAt: number; expiresAt: number; attributions: string[] };
export const WEATHER_TTL = 30 * 60 * 1000;

export function validWeatherCoordinates(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
