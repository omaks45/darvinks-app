
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Search by whichever identifier the manager has on hand — a new Tier1
// might only have shared their phone number verbally in the field, while
// a returning hire's employeeRef is on their ID card. At least one of the
// three must be provided; the service validates that.
export class FindUserToLinkDto {
    @ApiPropertyOptional({ example: 'Dar-00000042' })
    @IsOptional()
    @IsString()
    employeeRef?: string;

    @ApiPropertyOptional({ example: '+2348012345678' })
    @IsOptional()
    @IsString()
    phone?: string;

    @ApiPropertyOptional({ example: 'kenny.solape@darvinks.com' })
    @IsOptional()
    @IsString()
    email?: string;
}

export class AddDirectReportDto {
    @ApiProperty({ description: 'User UUID of the person who will now report to you' })
    @IsString()
    userId: string;
}