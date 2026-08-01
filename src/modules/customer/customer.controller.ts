
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { CustomerService } from './customer.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
  OutOfRegionRequestDto,
} from './dto/customer.dto';

@ApiTags('Customers')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @ApiResponse({ status: 201, description: 'Customer created. Field agents (Tier 1-4) must provide GPS coordinates — address is auto-resolved from Google Maps. Admin provides address manually.', schema: { example: { success: true, data: { id: '1feb91cb-a63c-4ca8-904d-ea7cdadbbaf8', businessName: 'Ore Ofe Distributors Ltd', address: '12 Kolade Street, Ilupeju, Lagos', mobilePhone: '+2348099900001', whatsApp: null, email: null, cacNumber: null, contactPerson: 'Chukwuemeka Obi', contactPhone: '+2348055500001', contactPosition: null, region: 'SOUTH_WEST', state: 'lagos', locationId: null, isActive: true, balanceKobo: 0, ownerId: 'agent-id', createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-25T10:49:41.366Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'GPS coordinates missing or state could not be determined', schema: { example: { success: false, statusCode: 400, message: 'latitude and longitude are required for field tier registration', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'GPS location is outside the agent\'s assigned region', schema: { example: { success: false, statusCode: 403, message: 'Your GPS location is in lagos (SOUTH_WEST), but your account is assigned to NORTH_BRIGHT. You must be physically present in your own region to register a customer.', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 409, description: 'Phone number already registered', schema: { example: { success: false, statusCode: 409, message: 'A customer with phone +2348099900001 already exists', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new key distributor / customer',
    description:
      'Region is derived automatically from the state. ' +
      'Field staff (Tiers 1–4) can only register customers in their own region.',
  })
  @ApiBody({ type: CreateCustomerDto })
  create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerService.create(dto, user);
  }

  @ApiResponse({ status: 200, description: 'Customer list. Field staff see only their region. Admins see all.', schema: { example: { success: true, data: [{ id: '1feb91cb-a63c-4ca8-904d-ea7cdadbbaf8', businessName: 'Ore Ofe Distributors Ltd', address: '12 Kolade Street, Ilupeju, Lagos', mobilePhone: '+2348099900001', region: 'SOUTH_WEST', state: 'lagos', isActive: true, balanceKobo: 0, ownerId: 'agent-id', createdAt: '2026-07-25T10:49:41.366Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get()
  @ApiOperation({
    summary: 'List customers',
    description:
      'Admins see all customers. Field staff see only customers in their region.',
  })
  findAll(
    @Query() query: CustomerQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerService.findAll(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single customer by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerService.findById(id, user);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update customer details',
    description: 'Only the registering agent or an admin can update a customer.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateCustomerDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerService.update(id, dto, user);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a customer' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerService.deactivate(id, user);
  }

  @Patch(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate a customer' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerService.reactivate(id, user);
  }

  @ApiResponse({ status: 201, description: 'Out-of-region access request submitted — status PENDING. Sales Head or Tier 4 ZSM must approve.', schema: { example: { success: true, data: { id: 'oor-id', customerId: 'cust-id', requestedById: 'agent-id', status: 'PENDING', note: 'Key distributor covering multiple areas', createdAt: '2026-07-29T12:00:00.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Customer is already in the agent\'s region', schema: { example: { success: false, statusCode: 400, message: 'Customer is already in your region — no request needed', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 409, description: 'Pending request already exists for this customer', schema: { example: { success: false, statusCode: 409, message: 'A pending out-of-region request already exists for this customer', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post(':id/out-of-region')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Request access to an out-of-region customer',
    description:
      'Field staff submit a request when they need to serve a customer ' +
      'outside their assigned region. Requires approval from Sales Head or above.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: OutOfRegionRequestDto })
  requestOutOfRegion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OutOfRegionRequestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerService.requestOutOfRegion(id, dto, user);
  }

  @Patch('out-of-region/:requestId/approve')
  @ApiOperation({
    summary: 'Approve an out-of-region request (Sales Head / Admin)',
  })
  @ApiParam({ name: 'requestId', type: 'string', format: 'uuid' })
  approveOutOfRegion(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.customerService.approveOutOfRegion(requestId, user);
  }
}