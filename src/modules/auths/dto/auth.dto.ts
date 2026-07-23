import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

// Login

export class LoginDto {
    @ApiProperty({ example: 'chioma.okafor@darvinks.com' })
    @IsEmail()
    @Transform(({ value }) => (value as string).toLowerCase().trim())
    email!: string;

    @ApiProperty({ minLength: 8 })
    @IsString()
    @MinLength(8)
    password!: string;
}

//Refresh / Logout

export class RefreshTokenDto {
    @ApiProperty({ description: 'The refresh token received at login' })
    @IsString()
    @IsNotEmpty()
    refreshToken!: string;
}

export class LogoutDto extends RefreshTokenDto {}

//  Response shapes

export class AuthTokensResponse {
    @ApiProperty() accessToken!: string;
    @ApiProperty() refreshToken!: string;
    @ApiProperty() expiresIn!: string;
}

export class RegisterResponse {
    @ApiProperty() userId!: string;
    @ApiProperty() employeeRef!: string;
    @ApiProperty() message!: string;
}