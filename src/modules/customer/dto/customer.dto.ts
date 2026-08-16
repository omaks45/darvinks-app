// src/modules/customers/dto/customer.dto.ts
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Region } from '@prisma/client';

export class CreateCustomerDto {
    @ApiProperty({
        enum:        ['PRIMARY', 'SECONDARY'],
        default:     'PRIMARY',
        description:
        'PRIMARY = Key Distributor (KD) — the agent collects stock FROM this customer. ' +
        'SECONDARY = Retailer / end buyer — the agent sells TO this customer. ' +
        'Stock collection invoices can only be raised against PRIMARY customers. ' +
        'When SECONDARY, also provide secondaryCustomerType.',
        example: 'PRIMARY',
    })
    @IsEnum(['PRIMARY', 'SECONDARY'])
    customerType: 'PRIMARY' | 'SECONDARY' = 'PRIMARY';

    @ApiPropertyOptional({
        enum:        ['SUB_DISTRIBUTOR', 'WHOLESALER', 'RETAILER'],
        description: 'Required when customerType is SECONDARY. Indicates the type of secondary customer.',
        example:     'WHOLESALER',
    })
    @IsOptional()
    @IsEnum(['SUB_DISTRIBUTOR', 'WHOLESALER', 'RETAILER'])
    secondaryCustomerType?: 'SUB_DISTRIBUTOR' | 'WHOLESALER' | 'RETAILER';

    @ApiProperty({ example: 'Ore Ofe Distributors Ltd' })
    @IsString()
    @IsNotEmpty()
    businessName: string;

    // ── Address — manual OR GPS ───────────────────────────────────────────────
    // Tier 2 must provide GPS coordinates (latitude + longitude) and the
    // server resolves the address from them. All other tiers provide address
    // and state directly as text. Both paths are optional individually but
    // the service enforces: Tier 2 must have lat/lng, everyone else must
    // have address + state. We cannot use @ValidateIf here because we don't
    // have the requester's tier in the DTO — that validation lives in the
    // service where the JwtPayload is available.

    @ApiPropertyOptional({
        example: '12 Kolade Street, Ilupeju, Lagos',
        description: 'Required for Admin tiers only. Field staff (Tiers 1–4) must use latitude/longitude instead — the address is resolved from GPS.',
    })
    @IsOptional()
    @IsString()
    address?: string;

    @ApiPropertyOptional({
        example: 6.5244,
        description: 'Required for field staff (Tiers 1–4) — GPS latitude captured by the mobile device at the KD\'s location.',
    })
    @IsOptional()
    @IsNumber()
    @IsLatitude()
    @Type(() => Number)
    latitude?: number;

    @ApiPropertyOptional({
        example: 3.3792,
        description: 'Required for field staff (Tiers 1–4) — GPS longitude captured by the mobile device at the KD\'s location.',
    })
    @IsOptional()
    @IsNumber()
    @IsLongitude()
    @Type(() => Number)
    longitude?: number;

    @ApiProperty({ example: '+2348012345678' })
    @IsString()
    @IsNotEmpty()
    mobilePhone: string;

    @ApiPropertyOptional({ example: '+2348012345678' })
    @IsOptional()
    @IsString()
    whatsApp?: string;

    @ApiPropertyOptional({ example: 'oreofedist@gmail.com' })
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiPropertyOptional({ example: 'RC123456' })
    @IsOptional()
    @IsString()
    cacNumber?: string;

    @ApiProperty({ example: 'Chukwuemeka Obi' })
    @IsString()
    @IsNotEmpty()
    contactPerson: string;

    @ApiProperty({ example: '+2348055555555' })
    @IsString()
    @IsNotEmpty()
    contactPhone: string;

    @ApiPropertyOptional({ example: 'Managing Director' })
    @IsOptional()
    @IsString()
    contactPosition?: string;

    @ApiPropertyOptional({
        example: 'lagos',
        description: 'Required for Admin tiers. Field staff (Tiers 1–4) derive state from GPS — only needed as a fallback if GPS returns no state.',
    })
    @IsOptional()
    @IsString()
    state?: string;

    @ApiPropertyOptional({
        example: 'uuid-of-location',
        description:
        'Optional — the market/town Location this KD operates in. ' +
        'Must be a valid Location UUID in the same state as the customer.',
    })
    @IsOptional()
    @IsString()
    locationId?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class CustomerQueryDto {
    @ApiPropertyOptional({ enum: Region })
    @IsOptional()
    @IsEnum(Region)
    region?: Region;

    @ApiPropertyOptional({ example: 'lagos' })
    @IsOptional()
    @IsString()
    state?: string;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    isActive?: boolean;

    @ApiPropertyOptional({
        enum:        ['PRIMARY', 'SECONDARY'],
        description: 'Filter by customer type. Used internally by /customers/primary and /customers/secondary endpoints.',
    })
    @IsOptional()
    @IsEnum(['PRIMARY', 'SECONDARY'])
    customerType?: 'PRIMARY' | 'SECONDARY';

    @ApiPropertyOptional({
        enum:        ['SUB_DISTRIBUTOR', 'WHOLESALER', 'RETAILER'],
        description: 'Filter secondary customers by sub-type. Only applies when customerType is SECONDARY.',
    })
    @IsOptional()
    @IsEnum(['SUB_DISTRIBUTOR', 'WHOLESALER', 'RETAILER'])
    secondaryCustomerType?: 'SUB_DISTRIBUTOR' | 'WHOLESALER' | 'RETAILER';
}

export class OutOfRegionRequestDto {
    @ApiPropertyOptional({ example: 'Customer is a key wholesale hub in this area' })
    @IsOptional()
    @IsString()
    note?: string;
}