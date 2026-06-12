// src/modules/purchase-orders/purchase-order.controller.ts
import {
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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
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

  @Patch(':id/approve')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Approve a purchase order (Sales Head / Admin)' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.approve(id, user);
  }

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

  @Patch(':id/cancel')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a purchase order' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.cancel(id, user);
  }

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

  @Patch(':id/documents')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: UploadDocumentDto })
  @ApiOperation({
    summary: 'Upload a document URL to a purchase order',
    description:
      'Attach KD invoice, cheque image, formal invoice, or delivery order. ' +
      'Uploading a delivery order automatically transitions status to DO_UPLOADED.',
  })
  uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.poService.uploadDocument(id, dto, user);
  }

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