
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
    InvoiceQualification,
    PaymentMode,
    PurchaseOrderStatus,
    WarehouseLocation,
} from '@prisma/client';

// ── Line item ──────────────────────────────────────────────────────────────────
export class OrderItemDto {
    @ApiProperty({ description: 'Product UUID' })
    @IsUUID()
    productId: string;

    @ApiProperty({ example: 10 })
    @IsInt()
    @Min(1)
    quantityCartons: number;
}

// ── Create ─────────────────────────────────────────────────────────────────────
export class CreatePurchaseOrderDto {
    @ApiProperty({ description: 'Customer (KD) UUID' })
    @IsUUID()
    customerId: string;

    @ApiProperty({ enum: WarehouseLocation })
    @IsEnum(WarehouseLocation)
    warehouseLocation: WarehouseLocation;

    @ApiProperty({ type: [OrderItemDto], minItems: 1 })
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => OrderItemDto)
    items: OrderItemDto[];

    @ApiPropertyOptional({ example: 50000, description: 'Credit to apply in kobo' })
    @IsOptional()
    @IsInt()
    @Min(0)
    creditAppliedKobo?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

// ── Record payment ─────────────────────────────────────────────────────────────
export class RecordPaymentDto {
    @ApiProperty({ example: 5000000, description: 'Amount in kobo' })
    @IsInt()
    @Min(1)
    amountKobo: number;

    @ApiProperty({ enum: PaymentMode })
    @IsEnum(PaymentMode)
    paymentMode: PaymentMode;

    @ApiPropertyOptional({ description: 'Cloudinary URL of payment proof' })
    @IsOptional()
    @IsString()
    proofUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

// ── Upload document ────────────────────────────────────────────────────────────
// The document file is uploaded directly via multipart/form-data.
// The server handles Cloudinary upload and stores the resulting URL.
// The client only needs to send: documentType (text field) + file (file field).
export class UploadDocumentDto {
    @ApiProperty({
        enum: ['kdInvoiceUrl', 'chequeUrl', 'formalInvoiceUrl', 'deliveryOrderUrl'],
        description: 'Which document slot to fill on the purchase order',
        example: 'kdInvoiceUrl',
    })
    @IsEnum(['kdInvoiceUrl', 'chequeUrl', 'formalInvoiceUrl', 'deliveryOrderUrl'])
    documentType: 'kdInvoiceUrl' | 'chequeUrl' | 'formalInvoiceUrl' | 'deliveryOrderUrl';
}

// ── Qualify invoice ────────────────────────────────────────────────────────────
export class QualifyInvoiceDto {
    @ApiProperty({ enum: InvoiceQualification })
    @IsEnum(InvoiceQualification)
    qualification: InvoiceQualification;

    @ApiPropertyOptional({ description: 'Mismatch details as JSON if NOT_QUALIFIED' })
    @IsOptional()
    invoiceMismatch?: Record<string, unknown>;
}

// ── Query ──────────────────────────────────────────────────────────────────────
export class PurchaseOrderQueryDto {
    @ApiPropertyOptional({ enum: PurchaseOrderStatus })
    @IsOptional()
    @IsEnum(PurchaseOrderStatus)
    status?: PurchaseOrderStatus;

    @ApiPropertyOptional({ enum: WarehouseLocation })
    @IsOptional()
    @IsEnum(WarehouseLocation)
    warehouseLocation?: WarehouseLocation;

    @ApiPropertyOptional({ description: 'Customer UUID' })
    @IsOptional()
    @IsUUID()
    customerId?: string;
}