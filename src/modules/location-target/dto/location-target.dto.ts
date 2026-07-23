
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsEnum, IsInt, IsOptional, IsString, Matches, Min,
} from 'class-validator';
import { TargetCategory } from '@prisma/client';

export class SetLocationTargetDto {
    @ApiProperty({ description: 'Location UUID' })
    @IsString()
    locationId: string;

    @ApiProperty({ enum: TargetCategory })
    @IsEnum(TargetCategory)
    category: TargetCategory;

    @ApiProperty({
        example: '2026-07',
        description: 'Period month in YYYY-MM format',
    })
    @IsString()
    @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
        message: 'periodMonth must be in YYYY-MM format e.g. 2026-07',
    })
    periodMonth: string;

    @ApiProperty({
        example: 5000,
        description:
        'Cartons for CREAM/SOAP/LOTION/MTN — kobo for SALES/COLLECTION',
    })
    @IsInt()
    @Min(1)
    targetValue: number;
}

export class LocationTargetQueryDto {
    @ApiPropertyOptional({ example: 'location-uuid' })
    @IsOptional()
    @IsString()
    locationId?: string;

    @ApiPropertyOptional({ enum: TargetCategory })
    @IsOptional()
    @IsEnum(TargetCategory)
    category?: TargetCategory;

    @ApiPropertyOptional({ example: '2026-07' })
    @IsOptional()
    @IsString()
    @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
    periodMonth?: string;
}