import { IsEnum, IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Team, Region, UserRole, UserTier } from '@prisma/client';

export class QueryUsersDto {
    /** Filter by team */
    @ApiPropertyOptional({ enum: Team })
    @IsOptional()
    @IsEnum(Team)
    team?: Team;

    /** Filter by region */
    @ApiPropertyOptional({ enum: Region })
    @IsOptional()
    @IsEnum(Region)
    region?: Region;

    /** Filter by role */
    @ApiPropertyOptional({ enum: UserRole })
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;

    /** Filter by tier */
    @ApiPropertyOptional({ enum: UserTier })
    @IsOptional()
    @IsEnum(UserTier)
    tier?: UserTier;

    /** Search by full name or employee ref */
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    search?: string;

    /** true = active only, false = inactive only, omit = all */
    @ApiPropertyOptional()
    @IsOptional()
    isActive?: boolean;

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