
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