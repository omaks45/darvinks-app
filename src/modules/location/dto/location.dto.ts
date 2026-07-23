
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Region } from '@prisma/client';

export class CreateLocationDto {
    @ApiProperty({ example: 'Arakale' })
    @IsString()
    @MinLength(2)
    name: string;

    @ApiProperty({ example: 'ondo', description: 'Lowercase state name' })
    @IsString()
    state: string;

    @ApiProperty({ enum: Region })
    @IsEnum(Region)
    region: Region;
}



export class LocationQueryDto {
    @ApiPropertyOptional({ enum: Region })
    @IsOptional()
    @IsEnum(Region)
    region?: Region;

    @ApiPropertyOptional({ example: 'ondo' })
    @IsOptional()
    @IsString()
    state?: string;
}