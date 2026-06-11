
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Min,
} from 'class-validator';
import { WarehouseLocation, StockMovementType } from '@prisma/client';

export class StockInboundDto {
    @ApiProperty({ description: 'Product UUID' })
    @IsUUID()
    productId: string;

    @ApiProperty({ enum: WarehouseLocation })
    @IsEnum(WarehouseLocation)
    warehouseLocation: WarehouseLocation;

    @ApiProperty({ example: 50, description: 'Number of cartons received' })
    @IsInt()
    @Min(1)
    quantityCartons: number;

    @ApiPropertyOptional({ example: 'BATCH-2026-001' })
    @IsOptional()
    @IsString()
    batchReference?: string;

    @ApiPropertyOptional({ example: 'Received from factory' })
    @IsOptional()
    @IsString()
    reasonNote?: string;
}

export class StockAdjustmentDto {
    @ApiProperty({ description: 'Product UUID' })
    @IsUUID()
    productId: string;

    @ApiProperty({ enum: WarehouseLocation })
    @IsEnum(WarehouseLocation)
    warehouseLocation: WarehouseLocation;

    @ApiProperty({
        example: -5,
        description:
        'Adjustment quantity in cartons. Positive = increase, Negative = decrease.',
    })
    @IsInt()
    quantityCartons: number;

    @ApiProperty({ example: 'Damaged stock write-off' })
    @IsString()
    reasonNote: string;
}

export class StockQueryDto {
    @ApiPropertyOptional({ enum: WarehouseLocation })
    @IsOptional()
    @IsEnum(WarehouseLocation)
    warehouseLocation?: WarehouseLocation;

    @ApiPropertyOptional({
        example: true,
        description: 'Filter to only show products below low stock threshold',
    })
    @IsOptional()
    lowStockOnly?: boolean;
}

export class MovementQueryDto {
    @ApiPropertyOptional({ enum: WarehouseLocation })
    @IsOptional()
    @IsEnum(WarehouseLocation)
    warehouseLocation?: WarehouseLocation;

    @ApiPropertyOptional({ enum: StockMovementType })
    @IsOptional()
    @IsEnum(StockMovementType)
    type?: StockMovementType;

    @ApiPropertyOptional({ description: 'Product UUID' })
    @IsOptional()
    @IsUUID()
    productId?: string;
}