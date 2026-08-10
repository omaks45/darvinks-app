
import { Module } from '@nestjs/common';
import { SecondarySaleInvoiceController } from './secondary-sale-invoice.controller';
import { SecondarySaleInvoiceService } from './secondary-sale-invoice.service';
import { CloudinaryModule } from '@modules/cloudinary/cloudinary.module';
import { ProductModule } from '@modules/products/products.module';

@Module({
  imports:     [CloudinaryModule, ProductModule],
  controllers: [SecondarySaleInvoiceController],
  providers:   [SecondarySaleInvoiceService],
  exports:     [SecondarySaleInvoiceService],
})
export class SecondarySaleInvoiceModule {}