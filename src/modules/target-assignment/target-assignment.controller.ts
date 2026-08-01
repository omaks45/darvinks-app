
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { TargetAssignmentService } from './target-assignment.service';
import {
  CreateRootTargetDto,
  SplitTargetDto,
  UpdateTargetDto,
  TargetAssignmentQueryDto,
} from './dto/target-assignment.dto';

@ApiTags('Target Assignments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('target-assignments')
export class TargetAssignmentController {
  constructor(private readonly targetService: TargetAssignmentService) {}

  @ApiResponse({ status: 201, description: 'Root targets created in bulk (one per category in a single transaction). Returns array of created assignments.', schema: { example: { success: true, data: [{ id: 'assign-id', assignedById: 'sh-id', assignedBy: { fullName: 'Adaeze Sales Head', employeeRef: 'Dar-00000002', tier: 'TIER5_SALES_HEAD' }, assignedToId: 'zsm-id', assignedTo: { fullName: 'Emeka ZSM', employeeRef: 'Dar-00000003', tier: 'TIER4' }, category: 'LOTION', period: 'MONTHLY', year: 2026, month: 7, quarter: null, week: null, targetCartons: 1000, parentAssignmentId: null, isStale: false, note: null, createdAt: '2026-07-25T10:49:41.366Z', updatedAt: '2026-07-25T10:49:41.366Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Assignee is wrong tier, deactivated, or duplicate category in request', schema: { example: { success: false, statusCode: 400, message: 'Each category may appear at most once per bulk assignment', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Only Sales Head can create root targets', schema: { example: { success: false, statusCode: 403, message: 'Only the Sales Head can create a root target assignment', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post('root')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a root target (Sales Head -> Tier4 only)',
    description: 'The starting point of the cascade. Only the Sales Head can call this.',
  })
  @ApiBody({ type: CreateRootTargetDto })
  createRoot(
    @Body() dto: CreateRootTargetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.targetService.createRoot(dto, user);
  }

  @ApiResponse({ status: 201, description: 'Target split among direct reports. Sum of children must equal parent exactly.', schema: { example: { success: true, data: [{ id: 'child-id', assignedToId: 'tier3-id', assignedTo: { fullName: 'Chidinma ATSM', employeeRef: 'Dar-00000004', tier: 'TIER3' }, category: 'LOTION', targetCartons: 600, parentAssignmentId: 'assign-id', isStale: false, createdAt: '2026-07-25T10:49:41.366Z' }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Children sum does not equal parent targetCartons', schema: { example: { success: false, statusCode: 400, message: 'Split total (900) does not equal parent target (1000). All cartons must be allocated.', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 403, description: 'Requester is not the assignee of this target', schema: { example: { success: false, statusCode: 403, message: 'You can only split targets assigned to you', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 409, description: 'A direct report already has a target for this period and category', schema: { example: { success: false, statusCode: 409, message: 'Chidinma ATSM already has a LOTION target for July 2026', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post(':id/split')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Parent target assignment ID' })
  @ApiBody({ type: SplitTargetDto })
  @ApiOperation({
    summary: 'Split a target among your direct reports',
    description:
      'Children must sum exactly to the parent target. Only the person who ' +
      'received the parent target may split it.',
  })
  split(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SplitTargetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.targetService.split(id, dto, user);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiBody({ type: UpdateTargetDto })
  @ApiOperation({
    summary: 'Edit a target you assigned',
    description:
      'Only the original assigner can edit. If this target already has ' +
      'children, they are flagged stale (values untouched) for manual review.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTargetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.targetService.update(id, dto, user);
  }

  @Get()
  @ApiOperation({
    summary: 'List target assignments',
    description: 'Sales Head/Admin see all. Everyone else sees only targets they assigned or received.',
  })
  findAll(
    @Query() query: TargetAssignmentQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.targetService.findAll(query, user);
  }

  @ApiResponse({ status: 200, description: 'Personal performance for the given month. Achievement combines secondary sales + confirmed purchase orders.', schema: { example: { success: true, data: [{ category: 'LOTION', targetCartons: 1000, achievedCartons: 400, achievedFromSecondarySales: 250, achievedFromPurchaseOrders: 150, balanceCartons: 600, percentAchieved: 40, isStale: false }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get('my-performance')
  @ApiQuery({ name: 'year', type: Number, example: 2026 })
  @ApiQuery({ name: 'month', type: Number, example: 6 })
  @ApiOperation({
    summary: 'Get my own target vs achievement for a given month',
    description: 'Feeds the individual performance widget shown on every tier\'s dashboard.',
  })
  getMyPerformance(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.targetService.getMyPerformance(user.sub, year, month);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get a single target assignment by ID' })
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.targetService.findById(id, user);
  }
}