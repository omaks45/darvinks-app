
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsArray, IsEnum, IsInt, IsOptional,
    IsString, IsUUID, Min, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMode } from '@prisma/client';

// ── Sale item ─────────────────────────────────────────────────────────────────

export class SaleInvoiceItemDto {
    @ApiProperty({ example: '328922b0-19d3-4d0c-b47f-827efdda1f53' })
    @IsUUID()
    productId: string;

    @ApiProperty({ example: 10, description: 'Cartons to sell (must not exceed agent in-hand stock)' })
    @IsInt()
    @Min(1)
    quantityCartons: number;
}

// ── Create secondary sale invoice (bulk per customer) ─────────────────────────

export class CreateSecondarySaleInvoiceDto {
    @ApiProperty({
        description: 'ID of the SECONDARY customer being sold to',
        example:     'cust-secondary-id',
    })
    @IsUUID()
    customerId: string;

    @ApiProperty({
        type:        [SaleInvoiceItemDto],
        description: 'Products and quantities being sold. Cannot exceed agent in-hand inventory.',
        example:     [
        { productId: '328922b0-...', quantityCartons: 10 },
        { productId: '5dfb17f2-...', quantityCartons: 5  },
        ],
    })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => SaleInvoiceItemDto)
    items: SaleInvoiceItemDto[];

    @ApiPropertyOptional({ example: 'Sold at Mushin market' })
    @IsOptional()
    @IsString()
    note?: string;
}

// ── Record payment ────────────────────────────────────────────────────────────

export class RecordSecondaryPaymentDto {
    @ApiProperty({
        description: 'Amount paid in kobo (₦1 = 100 kobo). Can be partial or full.',
        example:     500000000,
    })
    @IsInt()
    @Min(1)
    amountKobo: number;

    @ApiProperty({ enum: PaymentMode, example: 'TRANSFER' })
    @IsEnum(PaymentMode)
    paymentMode: PaymentMode;

    @ApiPropertyOptional({ example: 'GTBank transfer confirmed' })
    @IsOptional()
    @IsString()
    note?: string;
}

// ── Query invoices ────────────────────────────────────────────────────────────

export class SecondarySaleInvoiceQueryDto {
    @ApiPropertyOptional({ description: 'Filter by secondary customer ID' })
    @IsOptional()
    @IsUUID()
    customerId?: string;

    @ApiPropertyOptional({ enum: ['UNPAID', 'PARTIAL', 'SETTLED'] })
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