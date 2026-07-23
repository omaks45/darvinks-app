import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength, Length } from "class-validator";

export class ResetPasswordDto {
    @ApiProperty({ example: 'agent@darvinks.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: '483921' })
    @IsString()
    @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
    otp: string;

    @ApiProperty({ example: 'NewSecurePass456!', minLength: 8 })
    @IsString()
    @MinLength(8)
    newPassword: string;
}