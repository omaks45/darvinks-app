import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserTier } from '@prisma/client';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { AdminService } from './admin.service';
import { ProvisionUserDto, ProvisionUserResponse } from '../auths/dto/provision-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserTier.TIER5_SYSTEM_ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── POST /admin/users/provision ──────────────────────────────────────────

  @Post('users/provision')
  @ApiOperation({
    summary: 'Provision a back-office account',
    description:
      'Creates an account for a back-office user (Sales Head, System Admin, ' +
      'Warehouse Admin, or General Manager). ' +
      'Field staff (Tiers 1–4) must self-register via the mobile app — ' +
      'they cannot be provisioned through this endpoint. ' +
      '\n\n**Sales Head:** one per team (BRIGHT or RADIANT). Team field is required. ' +
      '\n\n**Warehouse Admin:** one per location. Warehouse location field is required. ' +
      '\n\n**System Admin / GM:** no team or location required. ' +
      '\n\nA temporary password is generated and emailed to the new user. ' +
      'The user must change it on first login.',
  })
  @ApiResponse({
    status: 201,
    description: 'Account provisioned successfully',
    schema: {
      example: {
        success: true,
        data: {
          userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          employeeRef: 'Dar-00000006',
          temporaryPassword: 'Xk9#mNpQ2v',
          message: 'Account created for Adaeze Okonkwo. A welcome email has been sent to adaeze@darvinks.com.',
        },
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Email/phone already exists, or a Sales Head / Warehouse Admin for that team/location already exists',
    schema: {
      example: {
        statusCode: 409,
        message: 'Team BRIGHT already has an active Sales Head (Chukwuemeka Obi). Deactivate the existing account first.',
        error: 'Conflict',
        path: '/api/v1/admin/users/provision',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error — e.g. missing team for Sales Head, missing warehouse for Warehouse Admin',
    schema: {
      example: {
        statusCode: 400,
        message: 'A Sales Head must be assigned to a team (BRIGHT or RADIANT)',
        error: 'Bad Request',
        path: '/api/v1/admin/users/provision',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Only System Admin can access this endpoint' })
  async provisionUser(
    @CurrentUser() requester: JwtPayload,
    @Body() dto: ProvisionUserDto,
  ): Promise<ProvisionUserResponse> {
    return this.adminService.provisionUser(requester, dto);
  }

  // ─── GET /admin/users ──────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({
    summary: 'List all users',
    description:
      'Returns all users in the system across all tiers, teams, and regions. ' +
      'Includes active and inactive accounts. ' +
      'Password hashes are never returned.',
  })
  @ApiResponse({
    status: 200,
    description: 'Full user list returned',
    schema: {
      example: {
        success: true,
        data: [
          {
            id: 'uuid',
            employeeRef: 'Dar-00000001',
            fullName: 'Kenny Solape',
            email: 'kenny@darvinks.com',
            role: 'MERCHANDISER',
            roleLabel: 'Merchandiser',
            tier: 'TIER1',
            team: 'BRIGHT',
            region: 'SS1',
            isActive: true,
            accountOrigin: 'SELF_REGISTERED',
          },
        ],
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  findAllUsers() {
    return this.adminService.findAllUsers();
  }

  // ─── GET /admin/users/:id ──────────────────────────────────────────────────

  @Get('users/:id')
  @ApiOperation({ summary: 'Get a single user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findUser(@Param('id') id: string) {
    return this.adminService.findUserById(id);
  }

  // ─── PATCH /admin/users/:id ────────────────────────────────────────────────

  @Patch('users/:id')
  @ApiOperation({
    summary: 'Update a user account',
    description:
      'System Admin can update any user\'s details. ' +
      'Updatable fields: fullName, phone, isActive, team (Sales Head only), ' +
      'warehouseLocation (Warehouse Admin only), annualTargets, fcmToken.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto);
  }

  // ─── PATCH /admin/users/:id/deactivate ────────────────────────────────────

  @Patch('users/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a user account',
    description:
      'Deactivates the user — they can no longer log in. ' +
      'All active refresh tokens are revoked immediately. ' +
      'Use this before provisioning a replacement for the same role/location.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  deactivateUser(
    @Param('id') id: string,
    @CurrentUser() requester: JwtPayload,
  ) {
    return this.adminService.deactivateUser(id, requester);
  }

  // ─── PATCH /admin/users/:id/reactivate ────────────────────────────────────

  @Patch('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a previously deactivated user account' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User reactivated' })
  reactivateUser(@Param('id') id: string) {
    return this.adminService.reactivateUser(id);
  }

  // ─── POST /admin/users/:id/reset-password ────────────────────────────────

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset a user\'s password',
    description:
      'Generates a new temporary password and emails it to the user. ' +
      'Sets mustChangePassword = true. ' +
      'All active sessions are revoked.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({
    status: 200,
    description: 'Password reset — new temporary password generated and emailed',
    schema: {
      example: {
        success: true,
        data: { message: 'Password reset email sent to kenny@darvinks.com' },
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  resetUserPassword(
    @Param('id') id: string,
  ) {
    return this.adminService.resetUserPassword(id);
  }

  // ─── GET /admin/provisioned ────────────────────────────────────────────────

  @Get('provisioned')
  @ApiOperation({
    summary: 'List all provisioned back-office accounts',
    description:
      'Returns all accounts created via provisioning (Sales Head, System Admin, ' +
      'Warehouse Admin, General Manager). Useful for auditing.',
  })
  findProvisionedUsers() {
    return this.adminService.findProvisionedUsers();
  }
}