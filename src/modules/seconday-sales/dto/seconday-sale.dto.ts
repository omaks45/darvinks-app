export class CreateSecondaySaleDto {}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BuyerType } from '@prisma/client';

export class SecondarySaleItemDto {
    @ApiProperty({ description: 'Product UUID' })
    @IsUUID()
    productId: string;

    @ApiProperty({ enum: BuyerType })
    @IsEnum(BuyerType)
    buyerType: BuyerType;

    @ApiPropertyOptional({ example: 5, description: 'Cartons sold' })
    @IsOptional()
    @IsInt()
    @Min(0)
    quantityCartons?: number;

    @ApiPropertyOptional({ example: 2, description: 'Rows/dozens sold' })
    @IsOptional()
    @IsInt()
    @Min(0)
    quantityRows?: number;

    @ApiPropertyOptional({ example: 10, description: 'Individual pieces sold' })
    @IsOptional()
    @IsInt()
    @Min(0)
    quantityPieces?: number;
}

export class CreateSecondarySaleDto {
    @ApiProperty({ description: 'Customer (KD) UUID where this sale was witnessed/made' })
    @IsUUID()
    kdAccountId: string;

    @ApiProperty({ example: 6.5244 })
    @IsNumber()
    @Min(-90)
    @Max(90)
    @Type(() => Number)
    latitude: number;

    @ApiProperty({ example: 3.3792 })
    @IsNumber()
    @Min(-180)
    @Max(180)
    @Type(() => Number)
    longitude: number;

    @ApiProperty({ example: '2026-06-15T10:30:00.000Z' })
    @IsDateString()
    deviceTime: string;

    @ApiProperty({ type: [SecondarySaleItemDto], minItems: 1 })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => SecondarySaleItemDto)
    items: SecondarySaleItemDto[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

export class SecondarySaleQueryDto {
    @ApiPropertyOptional({ description: 'Customer UUID' })
    @IsOptional()
    @IsUUID()
    kdAccountId?: string;

    @ApiPropertyOptional({ enum: BuyerType })
    @IsOptional()
    @IsEnum(BuyerType)
    buyerType?: BuyerType;

    @ApiPropertyOptional({ example: '2026-06-01' })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: '2026-06-30' })
    @IsOptional()
    @IsDateString()
    to?: string;
}