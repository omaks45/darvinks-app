
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