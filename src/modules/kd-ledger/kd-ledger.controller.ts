// src/modules/kd-ledger/kd-ledger.controller.ts
import {
  Body, Controller, Get, HttpCode, HttpStatus, Param,
  ParseUUIDPipe, Post, Put, Query, UploadedFile,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation,
  ApiParam, ApiQuery, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { KdLedgerService } from './kd-ledger.service';
import { RecordKdPaymentDto, UpdateLedgerTotalDto } from './dto/kd-ledger.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { CloudinaryService } from '@modules/cloudinary/cloudinary.service';
import { BadRequestException } from '@nestjs/common';

@ApiTags('KD Ledger')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('kd-ledger')
export class KdLedgerController {
  constructor(
    private readonly service:    KdLedgerService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  // ── GET /kd-ledger ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List KD ledger entries',
    description: 'Tier 2-4 see only ledger entries from their own POs. Admins see all. Filter by customerId.',
  })
  @ApiQuery({ name: 'customerId', required: false, type: 'string' })
  @ApiResponse({
    status: 200,
    description: 'Ledger entries list',
    schema: {
      example: {
        success: true,
        data: [{
          id:              'ledger-id',
          customerId:      'kd-id',
          customer:        { businessName: 'Ore Ofe Distributors', region: 'SOUTH_WEST' },
          purchaseOrderId: 'po-id',
          purchaseOrder:   { orderRef: 'PO-000001', totalKobo: 2223000000 },
          receiptUrl:      'https://res.cloudinary.com/dwiouwwom/.../receipt.jpg',
          totalKobo:       2223000000,
          paidKobo:        1000000000,
          balanceKobo:     1223000000,
          status:          'PARTIAL',
          ocrExtracted:    true,
          payments:        [],
          createdAt:       '2026-08-10T09:00:00.000Z',
        }],
        timestamp: '2026-08-10T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T12:00:00.000Z' } } })
  findAll(
    @Query('customerId') customerId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.findAll(customerId, user);
  }

  // ── GET /kd-ledger/by-po/:purchaseOrderId ────────────────────────────────────

  @Get('by-po/:purchaseOrderId')
  @ApiParam({ name: 'purchaseOrderId', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Get ledger entry for a specific Purchase Order',
    description:
      'Returns the KD ledger entry linked to a PO. ' +
      'Agent opens this after seeing the PO approved to check how much the KD has paid. ' +
      'Returns null ledgerEntry if no receipt has been uploaded yet.',
  })
  @ApiResponse({
    status: 200,
    description: 'PO + ledger entry (ledgerEntry is null if receipt not yet uploaded)',
    schema: {
      example: {
        success: true,
        data: {
          purchaseOrder: {
            id: 'po-id', orderRef: 'PO-000001', status: 'APPROVED',
            totalKobo: 2223000000, approvalReceiptUrl: 'https://res.cloudinary.com/...',
          },
          ledgerEntry: {
            id:           'ledger-id',
            totalKobo:    2223000000,
            paidKobo:     0,
            balanceKobo:  2223000000,
            status:       'UNPAID',
            ocrExtracted: true,
            payments:     [],
          },
        },
        timestamp: '2026-08-10T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not your PO', schema: { example: { success: false, statusCode: 403, message: 'You can only view ledger entries for your own purchase orders', timestamp: '2026-08-10T12:00:00.000Z' } } })
  @ApiResponse({ status: 404, description: 'PO not found', schema: { example: { success: false, statusCode: 404, message: 'Purchase order not found', timestamp: '2026-08-10T12:00:00.000Z' } } })
  getByPurchaseOrder(
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.getByPurchaseOrder(purchaseOrderId, user);
  }

  // ── POST /kd-ledger/by-po/:purchaseOrderId/receipt ───────────────────────────

  @Post('by-po/:purchaseOrderId/receipt')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'purchaseOrderId', type: 'string', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload the approved PO receipt image. OCR will extract the total automatically.',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Receipt image (JPEG, PNG, or PDF)' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload approved PO receipt — triggers OCR extraction',
    description:
      'Tier 2-4 (PO creator) uploads the receipt they received after PO approval. ' +
      'Google Vision API extracts the total amount from the image. ' +
      'If OCR succeeds, totalKobo is set automatically (ocrExtracted: true). ' +
      'If OCR fails, use PUT /kd-ledger/:id/total to set manually. ' +
      'Creates or updates the KD ledger entry for this PO.',
  })
  @ApiResponse({
    status: 201,
    description: 'Receipt uploaded — OCR queued in background',
    schema: {
      example: {
        success: true,
        data: {
          id:           'ledger-id',
          receiptUrl:   'https://res.cloudinary.com/dwiouwwom/.../receipt.jpg',
          totalKobo:    2223000000,
          paidKobo:     0,
          balanceKobo:  2223000000,
          status:       'UNPAID',
          ocrExtracted: false,
        },
        timestamp: '2026-08-10T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'PO not approved yet or no file attached', schema: { example: { success: false, statusCode: 400, message: 'PO must be approved before uploading a receipt', timestamp: '2026-08-10T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T12:00:00.000Z' } } })
  @UseInterceptors(FileInterceptor('file'))
  async uploadReceipt(
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) throw new BadRequestException('A receipt file is required');

    // Upload to Cloudinary
    const resourceType = file.mimetype === 'application/pdf' ? 'raw' : 'image';
    const uploadResult = await this.cloudinary.uploadBuffer(file.buffer, 'receipts', {
      publicId:     `po-${purchaseOrderId}-receipt-${Date.now()}`,
      resourceType: resourceType as any,
    });

    return this.service.createOrUpdateWithReceipt(
      purchaseOrderId,
      uploadResult.secure_url,
      user,
    );
  }

  // ── PUT /kd-ledger/:id/total ──────────────────────────────────────────────────

  @Put(':id/total')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Manually set ledger total if OCR extraction failed',
    description: 'Used when Vision API could not read the receipt clearly. Agent manually types the total from the receipt.',
  })
  @ApiBody({ type: UpdateLedgerTotalDto })
  @ApiResponse({ status: 200, description: 'Total updated', schema: { example: { success: true, data: { id: 'ledger-id', totalKobo: 2223000000, ocrExtracted: false, status: 'UNPAID' }, timestamp: '2026-08-10T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T12:00:00.000Z' } } })
  @ApiResponse({ status: 404, description: 'Ledger entry not found', schema: { example: { success: false, statusCode: 404, message: 'Ledger entry not found', timestamp: '2026-08-10T12:00:00.000Z' } } })
  updateTotal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLedgerTotalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateTotal(id, dto, user);
  }

  // ── POST /kd-ledger/:id/payments ──────────────────────────────────────────────

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Record a KD payment against a ledger entry',
    description:
      'Tier 2-4 records a payment made by the KD against the approved PO. ' +
      'Payment can be partial or full. ' +
      'PARTIAL: balanceKobo reduces, status = PARTIAL. ' +
      'SETTLED: balanceKobo = 0, no more debt for this PO.',
  })
  @ApiBody({ type: RecordKdPaymentDto })
  @ApiResponse({
    status: 201,
    description: 'Payment recorded',
    schema: {
      example: {
        success: true,
        data: {
          payment:      { id: 'pay-id', amountKobo: 1000000000, paymentMode: 'TRANSFER', createdAt: '2026-08-10T14:00:00.000Z' },
          ledgerStatus: 'PARTIAL',
          paidKobo:     1000000000,
          balanceKobo:  1223000000,
          fullySettled: false,
        },
        timestamp: '2026-08-10T14:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Payment exceeds balance or ledger already settled', schema: { example: { success: false, statusCode: 400, message: 'Payment exceeds outstanding balance', timestamp: '2026-08-10T14:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T14:00:00.000Z' } } })
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordKdPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.recordPayment(id, dto, user);
  }
}