
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { PurchaseOrderService } from './purchase.service';
import {
  CreatePurchaseOrderDto,
  RecordPaymentDto,
  UploadDocumentDto,
  QualifyInvoiceDto,
  PurchaseOrderQueryDto,
} from './dto/purchase.dto';

@ApiTags('Purchase Orders')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly poService: PurchaseOrderService) {}

  @ApiResponse({ status: 201, description: 'Purchase order created — status PENDING_APPROVAL', schema: { example: { success: true, data: { id: '9dd46333-04b5-41a1-b3f9-baed52bf2242', orderRef: 'PO-000001', customerId: '1feb91cb-a63c-4ca8-904d-ea7cdadbbaf8', customer: { businessName: 'Ore Ofe Distributors Ltd', region: 'SOUTH_WEST' }, warehouseLocation: 'LAGOS_HQ', status: 'PENDING_APPROVAL', qualification: 'PENDING', subtotalKobo: 2223000000, creditAppliedKobo: 0, totalKobo: 2223000000, paidKobo: 0, paymentDeadline: null, createdById: 'agent-id', cashDiscountKobo: 0, incentiveKobo: 0, kdInvoiceUrl: null, chequeUrl: null, formalInvoiceUrl: null, deliveryOrderUrl: null, invoiceMismatch: null, approvedById: null, approvedAt: null, deliveredById: null, deliveredAt: null, fullyPaidAt: null, note: null, items: [{ id: 'item-id', productId: 'prod-id', product: { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' }, quantityCartons: 150, unitPriceKobo: 6300000, lineTotalKobo: 945000000 }], payments: [], createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-25T10:49:41.366Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Customer inactive or product not found', schema: { example: { success: false, statusCode: 400, message: 'Customer is deactivated', error: 'Bad Request', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not clocked in today', schema: { example: { success: false, statusCode: 403, message: 'You must clock in before performing this action', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 404, description: 'Customer or product not found', schema: { example: { success: false, statusCode: 404, message: 'Customer cust-id not found', error: 'Not Found', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a purchase order',
    description:
      'Field staff create POs for their KD customers. ' +
      'Prices are locked at the current product catalogue price.',
  })
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: JwtPayload) {
    return this.poService.create(dto, user);
  }

  @ApiResponse({ status: 200, description: 'List of purchase orders — field staff see only their own; admins see all', schema: { example: { success: true, data: [{ id: '9dd46333-04b5-41a1-b3f9-baed52bf2242', orderRef: 'PO-000001', customerId: '1feb91cb-a63c-4ca8-904d-ea7cdadbbaf8', customer: { businessName: 'Ore Ofe Distributors Ltd', region: 'SOUTH_WEST' }, warehouseLocation: 'LAGOS_HQ', status: 'PENDING_APPROVAL', qualification: 'PENDING', subtotalKobo: 2223000000, totalKobo: 2223000000, paidKobo: 0, paymentDeadline: null, createdById: 'agent-id', createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-25T10:49:41.366Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get()
  @ApiOperation({
    summary: 'List purchase orders',
    description: 'Admins see all POs. Field staff see only their own.',
  })
  findAll(@Query() query: PurchaseOrderQueryDto, @CurrentUser() user: JwtPayload) {
    return this.poService.findAll(query, user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get a purchase order with full detail' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.findById(id, user);
  }

  @ApiResponse({ status: 200, description: 'PO approved — status transitions to APPROVED. Requires invoice uploaded and qualification not PENDING.', schema: { example: { success: true, data: { id: '9dd46333-04b5-41a1-b3f9-baed52bf2242', orderRef: 'PO-000001', status: 'APPROVED', qualification: 'QUALIFIED', approvedById: 'sh-id', approvedAt: '2026-07-29T12:00:00.000Z', totalKobo: 2223000000 }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'KD invoice not uploaded or qualification still PENDING/NOT_QUALIFIED', schema: { example: { success: false, statusCode: 400, message: 'KD invoice must be uploaded before approval', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Only Sales Head or System Admin can approve', schema: { example: { success: false, statusCode: 403, message: 'Forbidden resource', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Patch(':id/approve')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Approve a purchase order (Sales Head / Admin)' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.approve(id, user);
  }

  @ApiResponse({ status: 200, description: 'Order marked as DELIVERED. Sets a 30-day payment deadline from today.', schema: { example: { success: true, data: { id: '9dd46333-04b5-41a1-b3f9-baed52bf2242', orderRef: 'PO-000001', status: 'DELIVERED', deliveredById: 'admin-id', deliveredAt: '2026-07-29T12:00:00.000Z', paymentDeadline: '2026-08-28T12:00:00.000Z', totalKobo: 2223000000, paidKobo: 0 }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Invalid state transition — order must be in DO_UPLOADED status', schema: { example: { success: false, statusCode: 400, message: 'Cannot transition from PENDING_APPROVAL to DELIVERED', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Only Admin can mark as delivered', schema: { example: { success: false, statusCode: 403, message: 'Forbidden resource', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Patch(':id/deliver')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Mark order as delivered (Admin)',
    description: 'Sets a 30-day payment deadline from delivery date.',
  })
  markDelivered(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.markDelivered(id, user);
  }

  @ApiResponse({ status: 200, description: 'PO cancelled. Only the creator or Admin can cancel. Cannot cancel after payment received.', schema: { example: { success: true, data: { id: '9dd46333-04b5-41a1-b3f9-baed52bf2242', orderRef: 'PO-000001', status: 'CANCELLED' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Cannot cancel — invalid state transition', schema: { example: { success: false, statusCode: 400, message: 'Cannot cancel after payment has been received', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Patch(':id/cancel')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a purchase order' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.cancel(id, user);
  }

  @ApiResponse({ status: 201, description: 'Payment recorded. If amountKobo equals remaining balance and order is DELIVERED, status transitions to FULLY_PAID.', schema: { example: { success: true, data: { id: 'pay-id', amountKobo: 500000000, paymentMode: 'TRANSFER', proofUrl: null, note: null, createdAt: '2026-07-29T12:00:00.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Payment exceeds outstanding balance or order not in payable state', schema: { example: { success: false, statusCode: 400, message: 'Payment of ₦5,000,000 would exceed the outstanding balance of ₦100,000', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: RecordPaymentDto })
  @ApiOperation({
    summary: 'Record a payment against a purchase order',
    description:
      'Can be called multiple times for partial payments. ' +
      'Order is automatically marked FULLY_PAID when total is reached.',
  })
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.recordPayment(id, dto, user);
  }

  @ApiResponse({ status: 200, description: 'Document uploaded and URL stored on PO. Uploading kdInvoiceUrl triggers OCR automatically (fire-and-forget — check qualification field after 3-5 seconds via GET /purchase-orders/:id). Uploading deliveryOrderUrl transitions status to DO_UPLOADED.', schema: { example: { success: true, data: { id: '9dd46333-04b5-41a1-b3f9-baed52bf2242', orderRef: 'PO-000001', status: 'PENDING_APPROVAL', qualification: 'PENDING', kdInvoiceUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../invoice.jpg', items: [{ productId: 'prod-id', product: { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' }, quantityCartons: 150, unitPriceKobo: 6300000, lineTotalKobo: 945000000 }], createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-29T12:00:00.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'No file attached', schema: { example: { success: false, statusCode: 400, message: 'A document file is required', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 404, description: 'Purchase order not found', schema: { example: { success: false, statusCode: 404, message: 'Purchase order not found', error: 'Not Found', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Patch(':id/documents')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @Patch(':id/documents')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Document type (text field) + the document file',
    schema: {
      type: 'object',
      required: ['documentType', 'file'],
      properties: {
        documentType: {
          type: 'string',
          enum: ['kdInvoiceUrl', 'chequeUrl', 'formalInvoiceUrl', 'deliveryOrderUrl'],
          example: 'kdInvoiceUrl',
        },
        file: {
          type: 'string',
          format: 'binary',
          description: 'The invoice/document image (JPEG, PNG, PDF)',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a document file to a purchase order',
    description:
      'Accepts multipart/form-data with a documentType text field and a file. ' +
      'Server uploads the file to Cloudinary and stores the resulting URL. ' +
      'Uploading a KD invoice triggers OCR comparison against PO line items. ' +
      'Uploading a delivery order automatically transitions status to DO_UPLOADED.',
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!file) {
      throw new BadRequestException('A document file is required');
    }
    return this.poService.uploadDocument(id, dto, file, user);
  }

  @ApiResponse({ status: 200, description: 'Invoice qualification updated manually. Sales Head can override OCR result.', schema: { example: { success: true, data: { id: '9dd46333-04b5-41a1-b3f9-baed52bf2242', qualification: 'QUALIFIED', status: 'PENDING_APPROVAL' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Only Sales Head or System Admin can qualify invoices', schema: { example: { success: false, statusCode: 403, message: 'Forbidden resource', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Patch(':id/qualify')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: QualifyInvoiceDto })
  @ApiOperation({ summary: 'Qualify or disqualify an invoice (Sales Head / Admin)' })
  qualifyInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QualifyInvoiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.qualifyInvoice(id, dto, user);
  }
}