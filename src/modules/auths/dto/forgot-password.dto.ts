
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class ForgotPasswordDto {
    @ApiProperty({ example: 'agent@darvinks.com' })
    @IsEmail()
    email: string;
}
