import { ApiPropertyOptional } from '@nestjs/swagger';
import { Team, WarehouseLocation } from '@prisma/client';
import {
    IsEnum,
    IsObject,
    IsOptional,
    IsPhoneNumber,
    IsString,
} from 'class-validator';

export class UpdateUserDto {
    @ApiPropertyOptional({ example: 'Kenny Solape Jr.' })
    @IsOptional()
    @IsString()
    fullName?: string;

    @ApiPropertyOptional({ example: '+2348099887766' })
    @IsOptional()
    @IsPhoneNumber()
    phone?: string;

    @ApiPropertyOptional({ enum: Team, description: 'Sales Head only' })
    @IsOptional()
    @IsEnum(Team)
    team?: Team;

    @ApiPropertyOptional({
        enum: WarehouseLocation,
        description: 'Warehouse Admin only',
    })
    @IsOptional()
    @IsEnum(WarehouseLocation)
    warehouseLocation?: WarehouseLocation;

    @ApiPropertyOptional({
        example: { LOTION: 600, SOAP: 400 },
        description: 'Update annual targets — System Admin only',
    })
    @IsOptional()
    @IsObject()
    annualTargets?: Record<string, number>;

    @ApiPropertyOptional({ description: 'FCM device token for push notifications' })
    @IsOptional()
    @IsString()
    fcmToken?: string;
}