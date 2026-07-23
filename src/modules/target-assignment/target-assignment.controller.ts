
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