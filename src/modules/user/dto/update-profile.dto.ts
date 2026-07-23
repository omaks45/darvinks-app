
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsPhoneNumber } from 'class-validator';

export class UpdateProfileDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsPhoneNumber()
    phone?: string;
}