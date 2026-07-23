
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsEmail,
    IsEnum,
    IsOptional,
    IsString,
} from 'class-validator';
import { Team, WarehouseLocation } from '@prisma/client';

// Only back-office roles can be invited — field staff self-register via mobile
export enum InvitableRole {
    SALES_HEAD      = 'SALES_HEAD',
    SYSTEM_ADMIN    = 'SYSTEM_ADMIN',
    WAREHOUSE_ADMIN = 'WAREHOUSE_ADMIN',
    GENERAL_MANAGER = 'GENERAL_MANAGER',
}

export class CreateInviteDto {
    @ApiProperty({ example: 'adaeze@darvinks.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ enum: InvitableRole, example: 'SALES_HEAD' })
    @IsEnum(InvitableRole)
    role: InvitableRole;

    @ApiPropertyOptional({
        enum: Team,
        description: 'Required for SALES_HEAD — one per team',
    })
    @IsOptional()
    @IsEnum(Team)
    team?: Team;

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