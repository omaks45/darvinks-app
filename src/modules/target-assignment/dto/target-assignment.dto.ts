
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductCategory, TargetPeriod } from '@prisma/client';

export class CreateRootTargetDto {
    @ApiProperty({ description: 'Tier4 user UUID receiving this target directly from the Sales Head' })
    @IsUUID()
    assignedToId: string;

    @ApiProperty({ enum: ProductCategory })
    @IsEnum(ProductCategory)
    category: ProductCategory;

    @ApiProperty({ enum: TargetPeriod, default: 'MONTHLY' })
    @IsEnum(TargetPeriod)
    period: TargetPeriod;

    @ApiProperty({ example: 2026 })
    @IsInt()
    year: number;

    @ApiPropertyOptional({ example: 2, description: 'Required when period = QUARTERLY' })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(4)
    quarter?: number;

    @ApiPropertyOptional({ example: 6, description: 'Required when period = MONTHLY' })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(12)
    month?: number;

    @ApiPropertyOptional({ example: 24, description: 'Required when period = WEEKLY' })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(53)
    week?: number;

    @ApiProperty({ example: 1000 })
    @IsInt()
    @Min(1)
    targetCartons: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

export class ChildSplitDto {
    @ApiProperty({ description: 'Direct report UUID receiving a slice of the parent target' })
    @IsUUID()
    assignedToId: string;

    @ApiProperty({ example: 350 })
    @IsInt()
    @Min(0)
    targetCartons: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

export class SplitTargetDto {
    @ApiProperty({
        type: [ChildSplitDto],
        minItems: 1,
        description:
        'Allocations for each direct report. The sum of targetCartons across ' +
        'all entries must exactly equal the parent assignment\'s targetCartons.',
    })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ChildSplitDto)
    children: ChildSplitDto[];
}

export class UpdateTargetDto {
    @ApiProperty({ example: 1200 })
    @IsInt()
    @Min(1)
    targetCartons: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

export class TargetAssignmentQueryDto {
    @ApiPropertyOptional({ description: 'Filter to a specific user' })
    @IsOptional()
    @IsUUID()
    assignedToId?: string;

    @ApiPropertyOptional({ enum: ProductCategory })
    @IsOptional()
    @IsEnum(ProductCategory)
    category?: ProductCategory;

    @ApiPropertyOptional({ example: 2026 })
    @IsOptional()
    @IsInt()
    year?: number;

    @ApiPropertyOptional({ description: 'Only return targets flagged stale' })
    @IsOptional()
    isStale?: boolean;
}