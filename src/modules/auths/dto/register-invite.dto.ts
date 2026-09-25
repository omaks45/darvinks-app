// src/modules/auths/dto/register-invite.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

// ─── Base DTO (Tier 5 / 6 back-office invite registrations) ─────────────────
//
// Fields required by ALL invite-based registrations:
//   - inviteToken  — the token from the invite link
//   - email        — must match the invite email (verified server-side)
//   - fullName, phone, password, dateOfBirth — personal details
//   - profilePicture — optional; appears on the generated ID card
//
// Role, team, and warehouseLocation are locked to the invite — the registrant
// never sends them. Region is derived server-side.

export class RegisterWithInviteDto {
  @ApiProperty({
    example: 'abc123xyz...',
    description: 'The invite token from the invite link or email',
  })
  @IsString()
  inviteToken: string;

  @ApiProperty({
    example: 'adaeze.okonkwo@darvinks.com',
    description:
      'Must match the email address the invite was sent to. ' +
      'Used to prevent invite token sharing.',
  })
  @IsEmail()
  email: string;

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

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Optional profile photo (JPEG / PNG, max 5 MB). Appears on the generated ID card.',
  })
  @IsOptional()
  profilePicture?: Express.Multer.File;
}

// ─── Field agent invite DTO (Tier 1–4) ───────────────────────────────────────
//
// Extends the base DTO with:
//   - state         — Nigerian state the agent operates in; used to auto-assign
//                     the region (NORTH_WEST, SOUTH_SOUTH, etc.)
//   - annualTargets — optional per-product targets set at registration time;
//                     can be updated later by Admin

export class FieldRegisterWithInviteDto extends RegisterWithInviteDto {
    @ApiProperty({
        example: 'Cross River',
        description:
        'Nigerian state the agent operates in. ' +
        'The system derives the region automatically from this value.',
    })
    @IsString()
    state: string;

    @ApiPropertyOptional({
        example: { LOTION: 500, SOAP: 300, CREAM: 200, MAINTENANCE: 100 },
        description:
        'Optional annual sales targets per product category. ' +
        'Can be left empty and set later by the Admin.',
    })
    @IsOptional()
    @IsObject()
    annualTargets?: Record<string, number>;
}