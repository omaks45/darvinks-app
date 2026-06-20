
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayMaxSize,
    IsArray,
    IsDateString,
    IsEnum,
    IsOptional,
    IsString,
    IsUrl,
    MaxLength,
    ValidateIf,
} from 'class-validator';
import { CompetitorReportMediaType, Region } from '@prisma/client';

export class CreateCompetitorReportDto {
    @ApiProperty({ enum: CompetitorReportMediaType })
    @IsEnum(CompetitorReportMediaType)
    mediaType: CompetitorReportMediaType;

    // Required when mediaType is PDF, IMAGE, or VIDEO — the uploaded file's
    // Cloudinary URL. The frontend uploads directly to Cloudinary (same
    // pattern as PO documents and collection receipts) and sends only the
    // resulting URL here, never a binary file.
    @ApiPropertyOptional({ description: 'Required for PDF/IMAGE/VIDEO media types' })
    @ValidateIf((dto) => dto.mediaType !== CompetitorReportMediaType.TEXT)
    @IsUrl()
    mediaUrl?: string;

    // Required when mediaType is TEXT — the written observation itself.
    @ApiPropertyOptional({ description: 'Required for TEXT media type' })
    @ValidateIf((dto) => dto.mediaType === CompetitorReportMediaType.TEXT)
    @IsString()
    @MaxLength(2000)
    textContent?: string;

    @ApiPropertyOptional({
        type: [String],
        example: ['pricing', 'new-product', 'promo'],
        description: 'Free-form tags for filtering the feed later',
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(10)
    @IsString({ each: true })
    tags?: string[];
}

export class CompetitorReportQueryDto {
    @ApiPropertyOptional({ enum: Region })
    @IsOptional()
    @IsEnum(Region)
    region?: Region;

    @ApiPropertyOptional({ description: 'Filter by a single tag' })
    @IsOptional()
    @IsString()
    tag?: string;

    @ApiPropertyOptional({ example: '2026-06-01' })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: '2026-06-30' })
    @IsOptional()
    @IsDateString()
    to?: string;
}