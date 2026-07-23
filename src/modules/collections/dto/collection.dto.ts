
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsDateString,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Min,
} from 'class-validator';
import { PaymentMode } from '@prisma/client';

export class CreateCollectionDto {
    @ApiProperty({ description: 'Customer UUID' })
    @IsUUID()
    customerId: string;

    @ApiProperty({ example: 5000000, description: 'Amount collected in kobo' })
    @IsInt()
    @Min(1)
    amountKobo: number;

    @ApiProperty({ enum: PaymentMode })
    @IsEnum(PaymentMode)
    paymentMode: PaymentMode;

    @ApiProperty({ description: 'Cloudinary URL of receipt photo' })
    @IsString()
    @IsNotEmpty()
    receiptUrl: string;

    @ApiProperty({ example: 'Emeka Obi', description: 'Name of person who deposited' })
    @IsString()
    @IsNotEmpty()
    depositorName: string;

    @ApiProperty({ example: 'Access Bank, Ilupeju Branch' })
    @IsString()
    @IsNotEmpty()
    location: string;

    @ApiProperty({ example: '2026-06-01T10:30:00.000Z' })
    @IsDateString()
    collectedAt: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

export class CollectionQueryDto {
    @ApiPropertyOptional({ description: 'Customer UUID' })
    @IsOptional()
    @IsUUID()
    customerId?: string;

    @ApiPropertyOptional({ enum: PaymentMode })
    @IsOptional()
    @IsEnum(PaymentMode)
    paymentMode?: PaymentMode;

    @ApiPropertyOptional({ example: '2026-06-01' })
    @IsOptional()
    @IsDateString()
    from?: string;

    @ApiPropertyOptional({ example: '2026-06-30' })
    @IsOptional()
    @IsDateString()
    to?: string;
}