import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Team } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
    IsDateString,
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsPhoneNumber,
    IsString,
    MinLength,
} from 'class-validator';
import { UserRole } from '@common/utils/role.utils';

export class RegisterDto {
    @ApiProperty({ example: 'Kenny Solape' })
    @IsString()
    @IsNotEmpty()
    fullName!: string;

    @ApiProperty({ example: 'kenny.solape@darvinks.com' })
    @IsEmail()
    @Transform(({ value }) => (value as string).toLowerCase().trim())
    email!: string;

    @ApiProperty({ example: '+2348012345678' })
    @IsPhoneNumber()
    phone!: string;

    @ApiProperty({ minLength: 8 })
    @IsString()
    @MinLength(8)
    password!: string;

    /**
     * The role the user selects from the registration dropdown.
     * The system derives the UserTier automatically — the client
     * never sends a tier directly.
     *
     * Example UI options (from the mobile mockup):
     *   Merchandiser / Promoter / DBSR / VSR  → TIER1
     *   Sales Representative / SSR            → TIER2
     *   ATSM / TSM                            → TIER3
     *   Zonal Sales Manager                   → TIER4
     *   Sales Head / System Admin             → TIER5
     *   Warehouse Admin                       → TIER5_WAREHOUSE
     *   General Manager                       → TIER6_GM
     */
    @ApiProperty({
        enum: UserRole,
        example: UserRole.MERCHANDISER,
        description: 'Role selected at registration — tier is assigned automatically',
    })
    @IsEnum(UserRole)
    role!: UserRole;

    @ApiProperty({ enum: Team, example: Team.BRIGHT })
    @IsEnum(Team)
    team!: Team;

    @ApiProperty({
        example: 'Cross River',
        description: 'Nigerian state — auto-assigns region',
    })
    @IsString()
    @IsNotEmpty()
    state!: string;

    @ApiProperty({ example: '1995-06-15' })
    @IsDateString()
    dateOfBirth!: string;

    @ApiPropertyOptional({
        example: { LOTION: 500, SOAP: 300, CREAM: 200, MAINTENANCE: 100 },
        description: 'Annual targets by SKU category — set at registration, editable by Admin only',
    })
    @IsOptional()
    @IsObject()
    annualTargets?: Record<string, number>;
}