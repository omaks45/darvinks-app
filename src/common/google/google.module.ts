
// Shared module — import wherever Google APIs are needed.

import { Module } from '@nestjs/common';
import { GoogleMapsService } from './google-map.service';
import { GoogleVisionService } from './google-vision.service';

@Module({
  providers: [GoogleMapsService, GoogleVisionService],
  exports:   [GoogleMapsService, GoogleVisionService],
})
export class GoogleModule {}