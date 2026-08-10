
import { Module } from '@nestjs/common';
import { StockCollectionController } from './stock-collection.controller';
import { StockCollectionService } from './stock-collection.service';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { ProductModule } from '@modules/products/products.module';

@Module({
  imports:     [CloudinaryModule, ProductModule],
  controllers: [StockCollectionController],
  providers:   [StockCollectionService],
  exports:     [StockCollectionService],
})
export class StockCollectionModule {}