
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

// Only System Admin and Warehouse Admin can manage the product catalogue.
// Field staff (Tiers 1–4) and Sales Head (Tier 5) are read-only.
const ADMIN_TIERS = ['TIER5_SYSTEM_ADMIN', 'WAREHOUSE_ADMIN'];

@ApiTags('Products')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  // ── Write endpoints (admin only) ───────────────────────────────────────────

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