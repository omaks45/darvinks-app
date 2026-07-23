
import { Module } from '@nestjs/common';
import { CollectionController } from './collections.controller';
import { CollectionService } from './collections.service';
import { ProductModule } from '@modules/products/products.module';

@Module({
  imports:     [ProductModule],
  controllers: [CollectionController],
  providers:   [CollectionService],
  exports:     [CollectionService],
})
export class CollectionModule {}