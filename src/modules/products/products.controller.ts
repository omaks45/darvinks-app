
import {
  Body,
  Controller,
  ForbiddenException,
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
import { ProductCategory } from '@prisma/client';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { ProductService } from './products.service';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
} from './dto/product.dto';

// Only System Admin can manage the product catalogue (create, update, deactivate,
// reactivate). Warehouse Admin, Sales Head, GM and field staff are all read-only.
//
// Rationale: adding or repricing a SKU is a commercial/administrative decision,
// not a warehouse operations decision. The Warehouse Admin manages stock levels
// for products that already exist in the catalogue — they should not be able to
// add new products or change prices unilaterally.
const ADMIN_TIERS = ['TIER5_SALES_SUPPORT'];

@ApiTags('Products')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // ── Write endpoints (admin only) ───────────────────────────────────────────

  @ApiResponse({ status: 201, description: 'Product created successfully', schema: { example: { success: true, data: { id: '328922b0-19d3-4d0c-b47f-827efdda1f53', name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION', packQty: 36, unitPriceKobo: 175000, cartonPriceKobo: 6300000, isActive: true, createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-25T10:49:41.366Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Validation error', schema: { example: { success: false, statusCode: 400, message: 'Validation error', error: 'Bad Request', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Forbidden — only System Admin can create products', schema: { example: { success: false, statusCode: 403, message: 'Forbidden resource', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 409, description: 'Product with same name and category already exists', schema: { example: { success: false, statusCode: 409, message: 'A LOTION product named \"Visita Essence B Whitening Lotion (250ml)\" already exists', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new product (System Admin / Warehouse Admin)',
    description: 'Adds a SKU to the product catalogue. Name + category must be unique.',
  })
  @ApiBody({ type: CreateProductDto })
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: JwtPayload,
  ) {
    this.assertAdminTier(user);
    return this.productService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a product (System Admin / Warehouse Admin)',
    description: 'All fields are optional — only provided fields are updated.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateProductDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: JwtPayload,
  ) {
    this.assertAdminTier(user);
    return this.productService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Deactivate a product (System Admin / Warehouse Admin)',
    description:
      'Marks the product as inactive. It remains in history but cannot be ordered.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    this.assertAdminTier(user);
    return this.productService.deactivate(id);
  }

  @Patch(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate a product (System Admin / Warehouse Admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    this.assertAdminTier(user);
    return this.productService.reactivate(id);
  }

  // ── Read endpoints (all authenticated users) ───────────────────────────────

  @ApiResponse({ status: 200, description: 'List of products', schema: { example: { success: true, data: [{ id: '328922b0-19d3-4d0c-b47f-827efdda1f53', name: 'Visita Essence B Whitening Lotion (250ml)', category: 'LOTION', packQty: 36, unitPriceKobo: 175000, cartonPriceKobo: 6300000, isActive: true, createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-25T10:49:41.366Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get()
  @ApiOperation({
    summary: 'List all products',
    description: 'Optional filters: category, isActive. Default returns all.',
  })
  findAll(@Query() query: ProductQueryDto) {
    return this.productService.findAll(query);
  }

  @Get('category/:category')
  @ApiOperation({
    summary: 'List active products by category',
    description: 'Used by the mobile app purchase order form to populate SKU dropdowns.',
  })
  @ApiParam({ name: 'category', enum: ProductCategory })
  findByCategory(@Param('category') category: ProductCategory) {
    return this.productService.findByCategory(category);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single product by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.productService.findById(id);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private assertAdminTier(user: JwtPayload): void {
    if (!ADMIN_TIERS.includes(user.tier as string)) {
      throw new ForbiddenException(
        'Only System Admin and Warehouse Admin can manage the product catalogue',
      );
    }
  }
}