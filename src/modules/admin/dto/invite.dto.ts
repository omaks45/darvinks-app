
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { WarehouseLocation } from '@prisma/client';
import { UserRole } from '@common/utils/role.utils';

/**
 * DTO for the invite endpoint used by FIELD TIER inviters
 * (TIER5_SALES_HEAD, TIER4, TIER3, TIER2).
 *
 * Team is automatically inherited from the inviter — the caller never sends it.
 * warehouseLocation is only relevant for WAREHOUSE_ADMIN, which is
 * provisioned directly by System Admin (not via this flow).
 *
 * Roles the caller is allowed to invite are validated inside AdminService
 * based on the inviter's tier — not here, to keep the DTO generic.
 */
export class CreateInviteDto {
    @ApiProperty({
        example: 'kenny.solape@darvinks.com',
        description: 'Email address of the person being invited',
    })
    @IsEmail()
    email: string;

    @ApiProperty({
        enum: UserRole,
        example: UserRole.MERCHANDISER,
        description:
        'Role to assign. Must be in the tier directly below the inviter\'s own tier. ' +
        'TIER5_SALES_HEAD → ZONAL_SALES_MANAGER | ' +
        'TIER4 → ATSM, TSM | ' +
        'TIER3 → SALES_REPRESENTATIVE, SSR | ' +
        'TIER2 → MERCHANDISER, PROMOTER, DBSR, VSR',
    })
    @IsEnum(UserRole)
    role: string;

    @ApiPropertyOptional({
        enum: WarehouseLocation,
        description: 'Required for WAREHOUSE_ADMIN',
    })
    @IsOptional()
    @IsEnum(WarehouseLocation)
    warehouseLocation?: WarehouseLocation;
}

export class RegisterWithInviteDto {
    @ApiProperty({ example: 'abc123xyz-invite-token' })
    @IsString()
    inviteToken: string;

    @ApiProperty({ example: 'Adaeze Okonkwo' })
    @IsString()
    fullName: string;

    @ApiProperty({ example: '+2348055555555' })
    @IsString()
    phone: string;

    @ApiProperty({ example: 'SecurePass123!' })
    @IsString()
    password: string;

    @ApiProperty({ example: '1990-03-15' })
    @IsString()
    dateOfBirth: string;
}