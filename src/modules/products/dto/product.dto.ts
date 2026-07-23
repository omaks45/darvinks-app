
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';
import { ProductCategory } from '@prisma/client';

export class CreateProductDto {
    @ApiProperty({ example: 'DarVinks Body Lotion 500ml' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({ enum: ProductCategory, example: 'LOTION' })
    @IsEnum(ProductCategory)
    category: ProductCategory;

    @ApiProperty({
        example: 12,
        description: 'Number of units per carton',
    })
    @IsInt()
    @Min(1)
    packQty: number;

    @ApiProperty({
        example: 150000,
        description: 'Unit price in kobo (e.g. 150000 = ₦1,500.00)',
    })
    @IsInt()
    @Min(1)
    unitPriceKobo: number;

    @ApiProperty({
        example: 1700000,
        description: 'Carton price in kobo (e.g. 1700000 = ₦17,000.00)',
    })
    @IsInt()
    @Min(1)
    cartonPriceKobo: number;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {
    @ApiPropertyOptional({
        example: true,
        description: 'Set to false to deactivate the product',
    })
    @IsOptional()
    isActive?: boolean;
}

export class ProductQueryDto {
    @ApiPropertyOptional({ enum: ProductCategory })
    @IsOptional()
    @IsEnum(ProductCategory)
    category?: ProductCategory;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    isActive?: boolean;
}