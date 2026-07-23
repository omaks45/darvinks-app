
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeocodeResult {
  address:  string;
  locality: string | null;
  state:    string | null;
}

@Injectable()
export class GoogleMapsService {
  private readonly logger  = new Logger(GoogleMapsService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api/geocode/json';

  constructor(private readonly config: ConfigService) {
    // Try config service first, fall back to process.env directly
    this.apiKey =
      this.config.get<string>('googleMapsApiKey') ??
      process.env.GOOGLE_MAPS_API_KEY ??
      '';

    if (!this.apiKey) {
      this.logger.warn(
        'GOOGLE_MAPS_API_KEY is not set. ' +
        'Attendance clock-in will save GPS coordinates instead of a readable address. ' +
        'Add GOOGLE_MAPS_API_KEY to your .env file to enable reverse geocoding.',
      );
    } else {
      this.logger.log('GoogleMapsService ready — reverse geocoding enabled');
    }
  }

  /**
   * Converts lat/lng to a formatted address string.
   * NEVER throws — a Maps outage must not block clock-in.
   * Falls back to "lat,lng" string when the API is unavailable or key is missing.
   */
  async reverseGeocode(
    latitude:  number,
    longitude: number,
  ): Promise<GeocodeResult> {
    const fallback: GeocodeResult = {
      address:  `${latitude},${longitude}`,
      locality: null,
      state:    null,
    };

    if (!this.apiKey) {
      return fallback;
    }

    try {
      const url = `${this.baseUrl}?latlng=${latitude},${longitude}&key=${this.apiKey}`;

      this.logger.debug(`Geocoding (${latitude}, ${longitude})...`);

      const res = await fetch(url);

      if (!res.ok) {
        this.logger.warn(`Maps API returned HTTP ${res.status} — using coordinate fallback`);
        return fallback;
      }

      const json = await res.json() as {
        status:  string;
        results: Array<{
          formatted_address: string;
          address_components: Array<{
            long_name:  string;
            types:      string[];
          }>;
        }>;
        error_message?: string;
      };

      if (json.status !== 'OK') {
        this.logger.warn(
          `Geocode status: ${json.status}` +
          (json.error_message ? ` — ${json.error_message}` : '') +
          ' — using coordinate fallback',
        );
        return fallback;
      }

      if (!json.results.length) {
        return fallback;
      }

      const best       = json.results[0];
      const components = best.address_components;

      const locality =
        this.findComponent(components, 'locality') ??
        this.findComponent(components, 'administrative_area_level_2') ??
        null;

      const state =
        this.findComponent(components, 'administrative_area_level_1') ??
        null;

      const result: GeocodeResult = {
        address:  best.formatted_address,
        locality,
        state,
      };

      this.logger.debug(`Geocoded to: ${result.address}`);
      return result;

    } catch (err) {
      this.logger.error(
        `Reverse geocode failed for (${latitude}, ${longitude}): ${(err as Error).message}`,
      );
      return fallback;
    }
  }

  private findComponent(
    components: Array<{ long_name: string; types: string[] }>,
    type:       string,
  ): string | undefined {
    return components.find((c) => c.types.includes(type))?.long_name;
  }
}