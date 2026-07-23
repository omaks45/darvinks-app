import { ApiPropertyOptional } from "@nestjs/swagger";
import { Region } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateLocationDto {
    @ApiPropertyOptional({ example: 'Arakale Market' })
    @IsOptional()
    @IsString()
    @MinLength(2)
    name?: string;

    @ApiPropertyOptional({ enum: Region })
    @IsOptional()
    @IsEnum(Region)
    region?: Region;
}