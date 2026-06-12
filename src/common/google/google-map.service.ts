
// Reverse geocodes GPS coordinates to a human-readable address.
// Used by AttendanceService on every clock-in, clock-out, and KD visit.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@common/config/app.config';

interface GeocodeResult {
  address:  string;
  locality: string | null; // city / LGA
  state:    string | null;
}

@Injectable()
export class GoogleMapsService {
  private readonly logger  = new Logger(GoogleMapsService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api/geocode/json';

  constructor(private readonly config: ConfigService<AppConfig>) {
    this.apiKey = this.config.get<string>('googleMapsApiKey' as any) ?? '';
  }

  /**
   * Converts lat/lng to a formatted address string.
   * Returns a fallback string if the API is unavailable — never throws,
   * so a Maps outage cannot block clock-in.
   */
  async reverseGeocode(
    latitude:  number,
    longitude: number,
  ): Promise<GeocodeResult> {
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY not set — skipping reverse geocode');
      return { address: `${latitude},${longitude}`, locality: null, state: null };
    }

    try {
      const url = `${this.baseUrl}?latlng=${latitude},${longitude}&key=${this.apiKey}`;
      const res  = await fetch(url);

      if (!res.ok) {
        throw new Error(`Maps API HTTP ${res.status}`);
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
      };

      if (json.status !== 'OK' || !json.results.length) {
        this.logger.warn(`Geocode returned status: ${json.status}`);
        return { address: `${latitude},${longitude}`, locality: null, state: null };
      }

      const best       = json.results[0];
      const components = best.address_components;

      const locality = this.findComponent(components, 'locality')
        ?? this.findComponent(components, 'administrative_area_level_2');

      const state = this.findComponent(components, 'administrative_area_level_1');

      return {
        address:  best.formatted_address,
        locality: locality ?? null,
        state:    state    ?? null,
      };
    } catch (err) {
      // Never block clock-in on a Maps failure
      this.logger.error(`Reverse geocode failed for (${latitude}, ${longitude})`, err);
      return { address: `${latitude},${longitude}`, locality: null, state: null };
    }
  }

  private findComponent(
    components: Array<{ long_name: string; types: string[] }>,
    type:       string,
  ): string | undefined {
    return components.find((c) => c.types.includes(type))?.long_name;
  }
}