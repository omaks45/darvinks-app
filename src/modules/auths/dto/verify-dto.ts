import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, Length } from "class-validator";

export class VerifyOtpDto {
    @ApiProperty({ example: 'agent@darvinks.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: '483921', description: '6-digit OTP sent to email' })
    @IsString()
    @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
    otp: string;
}
