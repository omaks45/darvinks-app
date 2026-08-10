
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PaymentMode } from '@prisma/client';

//  Record KD payment against a ledger entry 

export class RecordKdPaymentDto {
    @ApiProperty({
        description: 'Amount paid by the KD in kobo. Can be partial or full.',
        example:     500000000,
    })
    @IsInt()
    @Min(1)
    amountKobo: number;

    @ApiProperty({ enum: PaymentMode, example: 'TRANSFER' })
    @IsEnum(PaymentMode)
    paymentMode: PaymentMode;

    @ApiPropertyOptional({ example: 'First instalment received via GTBank' })
    @IsOptional()
    @IsString()
    note?: string;
}

// ── Manually set ledger total (if OCR fails) ──────────────────────────────────

export class UpdateLedgerTotalDto {
    @ApiProperty({
        description: 'Total amount on approved PO receipt in kobo',
        example:     2223000000,
    })
    @IsInt()
    @Min(1)
    totalKobo: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}