
import {
  Body, Controller, Get, HttpCode, HttpStatus,
  Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SecondarySaleInvoiceService } from './secondary-sale-invoice.service';
import {
  CreateSecondarySaleInvoiceDto,
  RecordSecondaryPaymentDto,
  SecondarySaleInvoiceQueryDto,
} from './dto/secondary-sale-invoice.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { ClockInGuard } from '@common/guards/clock-in.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';

@ApiTags('Secondary Sale Invoices')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('secondary-sale-invoices')
export class SecondarySaleInvoiceController {
  constructor(private readonly service: SecondarySaleInvoiceService) {}

  // ── POST /secondary-sale-invoices ─────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ClockInGuard)
  @ApiOperation({
    summary: 'Sell stock to a Secondary Customer (bulk per customer)',
    description:
      'Tier 1-3 selects from their in-hand inventory and sells to a SECONDARY customer ' +
      '(sub-distributor, wholesaler, or retailer). ' +
      'All items for one customer in a single request — one call = one customer = one invoice. ' +
      'Agent inventory reduces by quantities sold. ' +
      'Customer balance increases by the total amount (recorded as debt). ' +
      'Branded PDF invoice generated automatically.',
  })
  @ApiBody({ type: CreateSecondarySaleInvoiceDto })
  @ApiResponse({
    status: 201,
    description: 'Sale invoice created — inventory deducted, customer debt recorded',
    schema: {
      example: {
        success: true,
        data: {
          id:          'inv-id',
          invoiceRef:  'SSI-000001',
          soldById:    'agent-id',
          soldBy:      { fullName: 'Kenny Solape', employeeRef: 'Dar-00000007', tier: 'TIER1' },
          customerId:  'sec-cust-id',
          customer:    { businessName: 'Bright Wholesalers', secondaryCustomerType: 'WHOLESALER' },
          totalKobo:   126000000,
          paidKobo:    0,
          balanceKobo: 126000000,
          status:      'UNPAID',
          invoiceUrl:  null,
          note:        null,
          createdAt:   '2026-08-10T10:30:00.000Z',
          items: [{
            productId:       'prod-id',
            product:         { name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION' },
            quantityCartons: 20,
            unitPriceKobo:   6300000,
            lineTotalKobo:   126000000,
          }],
          payments: [],
        },
        timestamp: '2026-08-10T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Insufficient in-hand stock or customer is not SECONDARY', schema: { example: { success: false, statusCode: 400, message: 'Insufficient stock for Visita Lotion. You have 10 carton(s) in hand but tried to sell 20.', timestamp: '2026-08-10T10:30:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T10:30:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not clocked in or wrong tier', schema: { example: { success: false, statusCode: 403, message: 'You must clock in before performing this action', timestamp: '2026-08-10T10:30:00.000Z' } } })
  create(
    @Body() dto: CreateSecondarySaleInvoiceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(dto, user);
  }

  // GET /secondary-sale-invoices/outstanding 

  @Get('outstanding')
  @ApiOperation({
    summary: 'Outstanding invoices (Make Payment page)',
    description:
      'Returns all UNPAID and PARTIAL invoices for the agent — ' +
      'this is the source for the Make Payment page. ' +
      'Agent picks an invoice and records the customer\'s payment.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unpaid and partial invoices sorted oldest-first (most urgent)',
    schema: {
      example: {
        success: true,
        data: [{
          id:          'inv-id',
          invoiceRef:  'SSI-000001',
          customer:    { businessName: 'Bright Wholesalers', secondaryCustomerType: 'WHOLESALER' },
          totalKobo:   126000000,
          paidKobo:    50000000,
          balanceKobo: 76000000,
          status:      'PARTIAL',
          createdAt:   '2026-08-10T10:30:00.000Z',
        }],
        timestamp: '2026-08-10T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T10:30:00.000Z' } } })
  getOutstanding(@CurrentUser() user: JwtPayload) {
    return this.service.getOutstanding(user);
  }

  // ── GET /secondary-sale-invoices ──────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List all sale invoices (invoice history)',
    description: 'Field staff see only their own. Admins see all. Filter by customerId, status, date range.',
  })
  @ApiResponse({
    status: 200,
    description: 'Invoice history list',
    schema: {
      example: {
        success: true,
        data: [{
          id:          'inv-id',
          invoiceRef:  'SSI-000001',
          customer:    { businessName: 'Bright Wholesalers', secondaryCustomerType: 'WHOLESALER' },
          totalKobo:   126000000,
          paidKobo:    0,
          balanceKobo: 126000000,
          status:      'UNPAID',
          invoiceUrl:  'https://res.cloudinary.com/dwiouwwom/.../SSI-000001-sale-invoice.pdf',
          createdAt:   '2026-08-10T10:30:00.000Z',
        }],
        timestamp: '2026-08-10T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T10:30:00.000Z' } } })
  findAll(
    @Query() query: SecondarySaleInvoiceQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.findAll(query, user);
  }

  // ── GET /secondary-sale-invoices/:id ─────────────────────────────────────────

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get full invoice detail including payment history' })
  @ApiResponse({ status: 200, description: 'Invoice detail with payment history', schema: { example: { success: true, data: { id: 'inv-id', invoiceRef: 'SSI-000001', status: 'PARTIAL', totalKobo: 126000000, paidKobo: 50000000, balanceKobo: 76000000, payments: [{ amountKobo: 50000000, paymentMode: 'TRANSFER', createdAt: '2026-08-10T12:00:00.000Z' }] }, timestamp: '2026-08-10T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T10:30:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not your invoice', schema: { example: { success: false, statusCode: 403, message: 'You can only view your own invoices', timestamp: '2026-08-10T10:30:00.000Z' } } })
  @ApiResponse({ status: 404, description: 'Invoice not found', schema: { example: { success: false, statusCode: 404, message: 'Invoice not found', timestamp: '2026-08-10T10:30:00.000Z' } } })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.findOne(id, user);
  }

  // ── POST /secondary-sale-invoices/:id/payments ────────────────────────────────

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Record a payment against a secondary sale invoice',
    description:
      'Payment can be partial or full. ' +
      'Partial payment: status → PARTIAL, balanceKobo reduces by payment amount. ' +
      'Full payment: status → SETTLED, balanceKobo → 0, customer debt cleared. ' +
      'Multiple payments allowed until invoice is SETTLED.',
  })
  @ApiBody({ type: RecordSecondaryPaymentDto })
  @ApiResponse({
    status: 201,
    description: 'Payment recorded',
    schema: {
      example: {
        success: true,
        data: {
          payment:       { id: 'pay-id', amountKobo: 50000000, paymentMode: 'TRANSFER', createdAt: '2026-08-10T12:00:00.000Z' },
          invoiceStatus: 'PARTIAL',
          paidKobo:      50000000,
          balanceKobo:   76000000,
          fullySettled:  false,
        },
        timestamp: '2026-08-10T12:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Payment exceeds outstanding balance or invoice already settled', schema: { example: { success: false, statusCode: 400, message: 'Payment of ₦1,500,000 exceeds outstanding balance of ₦760,000', timestamp: '2026-08-10T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-08-10T10:30:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Not your invoice', schema: { example: { success: false, statusCode: 403, message: 'You can only record payments for your own invoices', timestamp: '2026-08-10T10:30:00.000Z' } } })
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordSecondaryPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.recordPayment(id, dto, user);
  }
}