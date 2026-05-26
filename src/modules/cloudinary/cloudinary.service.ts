
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import type { AppConfig, CloudinaryConfig } from '../../common/config/app.config';

export type CloudinaryFolder =
  | 'attendance/clock-in'
  | 'attendance/clock-out'
  | 'attendance/kd-visits'
  | 'profiles'
  | 'id-cards'
  | 'invoices'
  | 'cheques'
  | 'payments'
  | 'delivery-orders'
  | 'competitor-reports';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly config: ConfigService<AppConfig>) {
    const cfg = this.config.get<CloudinaryConfig>('cloudinary')!;
    cloudinary.config({
      cloud_name: cfg.cloudName,
      api_key: cfg.apiKey,
      api_secret: cfg.apiSecret,
    });
  }

  /**
   * Uploads a file buffer to Cloudinary.
   * For attendance photos, applies a timestamp+location watermark via transformation.
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: CloudinaryFolder,
    options: {
      publicId?: string;
      watermarkText?: string;
      resourceType?: 'image' | 'raw' | 'auto';
    } = {},
  ): Promise<UploadApiResponse> {
    const { publicId, watermarkText, resourceType = 'image' } = options;

    return new Promise((resolve, reject) => {
      const uploadOptions: Record<string, unknown> = {
        folder: `tb-darvinks/${folder}`,
        resource_type: resourceType,
        ...(publicId ? { public_id: publicId } : {}),
        transformation: watermarkText
          ? [
              {
                overlay: {
                  font_family: 'Arial',
                  font_size: 20,
                  font_weight: 'bold',
                  text: watermarkText,
                },
                gravity: 'south_east',
                x: 10,
                y: 10,
                color: '#FFFFFF',
                opacity: 80,
              },
            ]
          : undefined,
      };

      const stream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error || !result) {
            this.logger.error('Cloudinary upload failed', error);
            reject(
              new InternalServerErrorException('File upload failed'),
            );
            return;
          }
          resolve(result);
        },
      );

      stream.end(buffer);
    });
  }

  /** Deletes a file from Cloudinary by its public_id. */
  async deleteFile(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      this.logger.warn(`Failed to delete Cloudinary file: ${publicId}`, error);
    }
  }
}