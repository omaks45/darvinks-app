
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';
import { Region } from '@prisma/client';

export class CreateCustomerDto {
    @ApiProperty({ example: 'Ore Ofe Distributors Ltd' })
    @IsString()
    @IsNotEmpty()
    businessName: string;

    @ApiProperty({ example: '12 Kolade Street, Ilupeju, Lagos' })
    @IsString()
    @IsNotEmpty()
    address: string;

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

    @ApiProperty({ example: 'lagos' })
    @IsString()
    @IsNotEmpty()
    state: string;
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
}

export class OutOfRegionRequestDto {
    @ApiPropertyOptional({ example: 'Customer is a key wholesale hub in this area' })
    @IsOptional()
    @IsString()
    note?: string;
}