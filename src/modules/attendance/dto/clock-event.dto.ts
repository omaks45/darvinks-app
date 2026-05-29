// src/modules/attendance/dto/clock-event.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ClockEventDto {
  @ApiProperty({ example: 6.5244, description: 'Device GPS latitude' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  latitude!: number;

  @ApiProperty({ example: 3.3792, description: 'Device GPS longitude' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  longitude!: number;

  @ApiProperty({
    example: '2026-04-14T08:29:00.000Z',
    description: 'ISO 8601 timestamp from device (supports offline sync)',
  })
  @IsDateString()
  deviceTime!: string;

  @ApiPropertyOptional({ description: 'Optional note from the field agent' })
  @IsOptional()
  @IsString()
  note?: string;
}

// ─── KD Visit ────────────────────────────────────────────────────────────────

export class KdVisitDto extends ClockEventDto {
  @ApiProperty({ description: 'ID of the KD account being visited' })
  @IsString()
  kdAccountId!: string;
}

// ─── Offline sync batch ───────────────────────────────────────────────────────

export class OfflineSyncItemDto extends ClockEventDto {
  @ApiProperty({ enum: ['CLOCK_IN', 'CLOCK_OUT', 'KD_VISIT'] })
  @IsString()
  type!: 'CLOCK_IN' | 'CLOCK_OUT' | 'KD_VISIT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  kdAccountId?: string;
}

// ─── Query filters ────────────────────────────────────────────────────────────

export class AttendanceQueryDto {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['CLOCK_IN', 'CLOCK_OUT', 'KD_VISIT'] })
  @IsOptional()
  @IsString()
  type?: string;
}