// Used by System Admin to create back-office accounts (Flow B & C).
// Never exposed on the public registration endpoint.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Team, WarehouseLocation } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
    IsDateString,
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsPhoneNumber,
    IsString,
    ValidateIf,
} from 'class-validator';
import { UserRole } from '@common/utils/role.utils';

// Roles that can be provisioned — back-office only
// Field staff (Tiers 1–4) always self-register
export const PROVISIONABLE_ROLES = [
    UserRole.SALES_HEAD,
    UserRole.SYSTEM_ADMIN,
    UserRole.WAREHOUSE_ADMIN,
    UserRole.GENERAL_MANAGER,
] as const;

export type ProvisionableRole = typeof PROVISIONABLE_ROLES[number];

export class ProvisionUserDto {
    @ApiProperty({ example: 'Adaeze Okonkwo' })
    @IsString()
    @IsNotEmpty()
    fullName!: string;

    @ApiProperty({ example: 'adaeze.okonkwo@darvinks.com' })
    @IsEmail()
    @Transform(({ value }) => (value as string).toLowerCase().trim())
    email!: string;

    @ApiProperty({ example: '+2348055555555' })
    @IsPhoneNumber()
    phone!: string;

    @ApiProperty({
        enum: PROVISIONABLE_ROLES,
        description:
        'Only back-office roles can be provisioned. ' +
        'Field staff (Tiers 1–4) must self-register via the app.',
        example: UserRole.WAREHOUSE_ADMIN,
    })
    @IsEnum(UserRole)
    role!: ProvisionableRole;

    @ApiPropertyOptional({
        enum: Team,
        description:
        'Required only for SALES_HEAD (one per team). ' +
        'Leave empty for SYSTEM_ADMIN, WAREHOUSE_ADMIN, GENERAL_MANAGER.',
        example: Team.BRIGHT,
    })
    @ValidateIf((o) => o.role === UserRole.SALES_HEAD)
    @IsEnum(Team)
    team?: Team;

    @ApiPropertyOptional({
        enum: WarehouseLocation,
        description:
        'Required only for WAREHOUSE_ADMIN — specifies which warehouse they manage. ' +
        'One admin per location: LAGOS_HQ, ONITSHA, or KANO.',
        example: WarehouseLocation.LAGOS_HQ,
    })
    @ValidateIf((o) => o.role === UserRole.WAREHOUSE_ADMIN)
    @IsEnum(WarehouseLocation)
    warehouseLocation?: WarehouseLocation;

    @ApiPropertyOptional({
        example: '1985-03-20',
        description: 'Optional for provisioned accounts',
    })
    @IsOptional()
    @IsDateString()
    dateOfBirth?: string;
}

// Response

export class ProvisionUserResponse {
    @ApiProperty() userId!: string;
    @ApiProperty() employeeRef!: string;
    @ApiProperty() temporaryPassword!: string;
    @ApiProperty() message!: string;
}