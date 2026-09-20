import { IsEnum, IsOptional, IsString, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceType } from '@prisma/client';

export class QueryAttendanceDto {
    @ApiPropertyOptional({ enum: AttendanceType })
    @IsOptional()
    @IsEnum(AttendanceType)
    type?: AttendanceType;

    /** Filter by a specific user (admin / field-support only) */
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    userId?: string;

    /** ISO date string — start of range (inclusive) */
    @ApiPropertyOptional({ example: '2026-08-01' })
    @IsOptional()
    @IsDateString()
    from?: string;

    /** ISO date string — end of range (inclusive) */
    @ApiPropertyOptional({ example: '2026-08-31' })
    @IsOptional()
    @IsDateString()
    to?: string;

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ default: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;
}