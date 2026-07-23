
import { Module } from '@nestjs/common';
import { LocationTargetController } from './location-target.controller';
import { LocationTargetService } from './location-target.service';

@Module({
  controllers: [LocationTargetController],
  providers:   [LocationTargetService],
  exports:     [LocationTargetService],
})
export class LocationTargetModule {}