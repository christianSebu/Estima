const BAN_SEARCH_URL = "https://api-adresse.data.gouv.fr/search/";

export interface GeocodedAddress {
  label: string;
  latitude: number;
  longitude: number;
  inseeCode: string;
  postalCode: string;
  city: string;
  score: number;
}

export class GeocodingError extends Error {}

interface BanFeature {
  properties: {
    label: string;
    citycode: string;
    postcode: string;
    city: string;
    score: number;
  };
  geometry: {
    coordinates: [number, number];
  };
}

interface BanSearchResponse {
  features: BanFeature[];
}

export async function geocodeAddress(address: string): Promise<GeocodedAddress> {
  const url = new URL(BAN_SEARCH_URL);
  url.searchParams.set("q", address);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new GeocodingError(`API BAN a répondu ${response.status}`);
  }

  const data = (await response.json()) as BanSearchResponse;
  const feature = data.features[0];
  if (!feature) {
    throw new GeocodingError(`Adresse introuvable : "${address}"`);
  }

  const [longitude, latitude] = feature.geometry.coordinates;
  return {
    label: feature.properties.label,
    latitude,
    longitude,
    inseeCode: feature.properties.citycode,
    postalCode: feature.properties.postcode,
    city: feature.properties.city,
    score: feature.properties.score,
  };
}
