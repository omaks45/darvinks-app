
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterWithInviteDto {
    @ApiProperty({ example: 'abc123xyz...' })
    @IsString()
    inviteToken: string;

    @ApiProperty({ example: 'Adaeze Okonkwo' })
    @IsString()
    fullName: string;

    @ApiProperty({ example: '+2348055555555' })
    @IsString()
    phone: string;

    @ApiProperty({ example: 'SecurePass123!', minLength: 8 })
    @IsString()
    @MinLength(8)
    password: string;

    @ApiProperty({ example: '1990-03-15' })
    @IsDateString()
    dateOfBirth: string;

    @ApiPropertyOptional({ type: 'string', format: 'binary' })
    @IsOptional()
    profilePicture?: Express.Multer.File;
}