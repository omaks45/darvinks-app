
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsArray, IsInt, IsOptional, IsString, IsUUID,
    Min, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

// Cart item

export class StockCollectionItemDto {
    @ApiProperty({ example: '328922b0-19d3-4d0c-b47f-827efdda1f53' })
    @IsUUID()
    productId: string;

    @ApiProperty({ example: 50, description: 'Number of cartons to collect' })
    @IsInt()
    @Min(1)
    quantityCartons: number;
}

// Create stock collection

export class CreateStockCollectionDto {
    @ApiProperty({
        description: 'ID of the PRIMARY customer (KD) being visited',
        example: '1feb91cb-a63c-4ca8-904d-ea7cdadbbaf8',
    })
    @IsUUID()
    sourceId: string;

    @ApiProperty({
        type:        [StockCollectionItemDto],
        description: 'Cart items — one entry per product. Minimum one item required.',
        example:     [
        { productId: '328922b0-...', quantityCartons: 50 },
        { productId: '5dfb17f2-...', quantityCartons: 100 },
        ],
    })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => StockCollectionItemDto)
    items: StockCollectionItemDto[];

    @ApiPropertyOptional({ example: 'Collected this morning before market opens' })
    @IsOptional()
    @IsString()
    note?: string;
}

// Query

export class StockCollectionQueryDto {
    @ApiPropertyOptional({ description: 'Filter by source (KD) customer ID' })
    @IsOptional()
    @IsUUID()
    sourceId?: string;

    @ApiPropertyOptional({ enum: ['DRAFT', 'CONFIRMED'] })
    @IsOptional()
    @IsString()
    status?: string;

    @ApiPropertyOptional({ example: '2026-08-01' })
    @IsOptional()
    @IsString()
    from?: string;

    @ApiPropertyOptional({ example: '2026-08-31' })
    @IsOptional()
    @IsString()
    to?: string;
}