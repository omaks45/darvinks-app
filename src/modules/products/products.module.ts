
import { Module } from '@nestjs/common';
import { ProductController } from './products.controller';
import { ProductService } from './products.service';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';

@Module({
  imports:     [CloudinaryModule],
  controllers: [ProductController],
  providers:   [ProductService],
  exports:     [ProductService],
})
export class ProductModule {}