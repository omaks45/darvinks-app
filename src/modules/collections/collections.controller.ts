
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { CollectionService } from './collections.service';
import { CreateCollectionDto, CollectionQueryDto } from './dto/collection.dto';

@ApiTags('Collections')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('collections')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @ApiResponse({ status: 201, description: 'Collection recorded. amountKobo automatically reduces the customer\'s balanceKobo. Receipt photo required.', schema: { example: { success: true, data: { id: 'coll-id', customerId: 'cust-id', recordedById: 'agent-id', amountKobo: 500000000, paymentMode: 'TRANSFER', receiptUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../receipt.jpg', depositorName: 'Chukwuemeka Obi', bankName: 'GTBank', collectedAt: '2026-07-29T14:00:00.000Z', note: null, createdAt: '2026-07-29T14:00:00.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Validation error or customer not found', schema: { example: { success: false, statusCode: 400, message: 'Customer not found', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: CreateCollectionDto })
  @ApiOperation({
    summary: 'Record a cash or transfer collection from a customer',
    description:
      'Atomically creates the collection record and decrements the customer balance. ' +
      'Receipt URL must be uploaded to Cloudinary before calling this endpoint.',
  })
  create(
    @Body() dto: CreateCollectionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.collectionService.create(dto, user);
  }

  @ApiResponse({ status: 200, description: 'Collection history. Field staff see only their own. Admins see all.', schema: { example: { success: true, data: [{ id: 'coll-id', customerId: 'cust-id', recordedById: 'agent-id', amountKobo: 500000000, paymentMode: 'TRANSFER', receiptUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../receipt.jpg', depositorName: 'Chukwuemeka Obi', bankName: 'GTBank', collectedAt: '2026-07-29T14:00:00.000Z', note: null, createdAt: '2026-07-29T14:00:00.000Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get()
  @ApiOperation({
    summary: 'List collections',
    description:
      'Admins see all. Field staff see only their own. ' +
      'Supports filtering by customer, payment mode, and date range.',
  })
  findAll(
    @Query() query: CollectionQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.collectionService.findAll(query, user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get a single collection by ID' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.collectionService.findById(id, user);
  }

  @Get('customers/:customerId/summary')
  @ApiParam({ name: 'customerId', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Get collection summary for a customer',
    description:
      'Returns total collected, outstanding balance, and collection count. ' +
      'Useful for the customer profile screen.',
  })
  getSummary(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.collectionService.getSummaryForCustomer(customerId, user);
  }
}