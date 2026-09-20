// src/modules/attendance/dto/clock-event.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// ─── Clock Event (clock-in / clock-out) ────────────────────────────────────────

/**
 * Body sent by the mobile client for clock-in and clock-out events.
 */
export class ClockEventDto {
  @ApiProperty({
    description: 'Device-local timestamp (ISO 8601). Used as the canonical event time.',
    example: '2025-01-15T08:03:22.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  deviceTime: string;

  @ApiProperty({ description: 'Latitude recorded by device GPS.', example: 6.5244 })
  @IsNumber()
  @IsLatitude()
  latitude: number;

  @ApiProperty({ description: 'Longitude recorded by device GPS.', example: 3.3792 })
  @IsNumber()
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({ description: 'Optional free-text note.', example: 'Traffic delay on Third Mainland Bridge.' })
  @IsOptional()
  @IsString()
  note?: string;
}

// ─── KD Visit ──────────────────────────────────────────────────────────────────

/**
 * Body sent when a field agent arrives at or departs from a KD customer site.
 * Extends ClockEventDto by requiring the target KD account.
 */
export class KdVisitDto extends ClockEventDto {
  @ApiProperty({
    description: 'UUID of the KdAccount being visited.',
    example: 'c3d4e5f6-a1b2-4c3d-8e9f-0a1b2c3d4e5f',
  })
  @IsUUID()
  @IsNotEmpty()
  kdAccountId: string;
}

// ─── Attendance Query ──────────────────────────────────────────────────────────

/**
 * Query parameters accepted by GET /attendance and GET /attendance/user/:id.
 * All fields are optional.
 */
export class AttendanceQueryDto {
  @ApiPropertyOptional({
    description: 'Filter events for a specific user (oversight tiers only; field staff always see their own).',
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 date-time lower bound (inclusive) for deviceTime.',
    example: '2025-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 date-time upper bound (inclusive) for deviceTime.',
    example: '2025-01-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Filter by attendance event type.',
    example: 'CLOCK_IN',
    enum: ['CLOCK_IN', 'CLOCK_OUT', 'KD_VISIT', 'KD_VISIT_END'],
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Page number (default: 1).', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Results per page (default: 20, max: 100).', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

// ─── Offline Sync Item ─────────────────────────────────────────────────────────

/**
 * A single attendance event captured while offline.
 * The mobile client queues these and uploads them in a multipart batch
 * (events[] + photos[] in matching order) once connectivity is restored.
 */
export class OfflineSyncItemDto {
  @ApiProperty({
    description: 'Attendance event type.',
    example: 'CLOCK_IN',
    enum: ['CLOCK_IN', 'CLOCK_OUT', 'KD_VISIT', 'KD_VISIT_END'],
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description: 'Device-local ISO 8601 timestamp at the time of the event.',
    example: '2025-01-15T08:03:22.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  deviceTime: string;

  @ApiProperty({ description: 'Latitude at the time of the event.', example: 6.5244 })
  @IsNumber()
  @IsLatitude()
  latitude: number;

  @ApiProperty({ description: 'Longitude at the time of the event.', example: 3.3792 })
  @IsNumber()
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({
    description: 'KD account UUID (required for KD_VISIT and KD_VISIT_END events).',
    example: 'c3d4e5f6-a1b2-4c3d-8e9f-0a1b2c3d4e5f',
  })
  @IsOptional()
  @IsUUID()
  kdAccountId?: string;

  @ApiPropertyOptional({ description: 'Optional free-text note.', example: 'No network — syncing now.' })
  @IsOptional()
  @IsString()
  note?: string;
}