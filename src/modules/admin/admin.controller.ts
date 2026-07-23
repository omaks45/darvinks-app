
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
import { CreateInviteDto } from './dto/invite.dto';
import {
  ApiBearerAuth,
  ApiBody,
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

// ─── Shared example shapes ────────────────────────────────────────────────────

const USER_EXAMPLE = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  employeeRef: 'Dar-00000001',
  fullName: 'Kenny Solape',
  email: 'kenny.solape@darvinks.com',
  phone: '+2348012345678',
  role: 'MERCHANDISER',
  roleLabel: 'Merchandiser',
  tier: 'TIER1',
  team: 'BRIGHT',
  region: 'SS1',
  state: 'Cross River',
  warehouseLocation: null,
  accountOrigin: 'SELF_REGISTERED',
  mustChangePassword: false,
  isActive: true,
  profilePictureUrl: 'https://res.cloudinary.com/darvinks/profiles/Dar-00000001.jpg',
  idCardUrl: 'https://res.cloudinary.com/darvinks/id-cards/Dar-00000001.pdf',
  fcmToken: null,
  provisionedById: null,
  dateOfBirth: '1995-06-15T00:00:00.000Z',
  annualTargets: { LOTION: 500, SOAP: 300, CREAM: 200, MAINTENANCE: 100 },
  createdAt: '2026-04-15T08:30:00.000Z',
  updatedAt: '2026-04-15T08:30:00.000Z',
};

const NOT_FOUND_EXAMPLE = {
  statusCode: 404,
  message: 'User not found',
  error: 'Not Found',
  path: '/api/v1/admin/users/bad-id',
  timestamp: '2026-04-15T08:30:00.000Z',
};

const UNAUTHORIZED_EXAMPLE = {
  statusCode: 401,
  message: 'Unauthorized',
  error: 'Unauthorized',
  path: '/api/v1/admin/users',
  timestamp: '2026-04-15T08:30:00.000Z',
};

const FORBIDDEN_EXAMPLE = {
  statusCode: 403,
  message: 'You do not have permission to access this resource',
  error: 'Forbidden',
  path: '/api/v1/admin/users',
  timestamp: '2026-04-15T08:30:00.000Z',
};

// ─────────────────────────────────────────────────────────────────────────────

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
    description: `
Creates an account for a **back-office user** — Sales Head, System Admin, Warehouse Admin, or General Manager.

**Important rules:**
- Field staff (Tiers 1–4) must **self-register** via the mobile app. This endpoint will reject those roles.
- **Sales Head**: requires \`team\` field. Only **one active Sales Head per team** is allowed. Deactivate the existing one first if replacing.
- **Warehouse Admin**: requires \`warehouseLocation\` field. Only **one active admin per warehouse** is allowed.
- **System Admin / GM**: no \`team\` or \`warehouseLocation\` needed.

A **12-character temporary password** is auto-generated and emailed to the new user.  
The user **must change their password on first login** (\`mustChangePassword: true\`).
    `,
  })
  @ApiBody({
    type: ProvisionUserDto,
    description: 'Provision payload',
    examples: {
      salesHead: {
        summary: 'Provisioning a Sales Head',
        value: {
          fullName: 'Chukwuemeka Obi',
          email: 'emeka.obi@darvinks.com',
          phone: '+2348055555555',
          role: 'SALES_HEAD',
          team: 'BRIGHT',
          dateOfBirth: '1982-03-10',
        },
      },
      warehouseAdmin: {
        summary: 'Provisioning a Warehouse Admin',
        value: {
          fullName: 'Adaeze Okonkwo',
          email: 'adaeze@darvinks.com',
          phone: '+2348066666666',
          role: 'WAREHOUSE_ADMIN',
          warehouseLocation: 'LAGOS_HQ',
        },
      },
      gm: {
        summary: 'Provisioning the General Manager',
        value: {
          fullName: 'Dr. Emeka Darvinks',
          email: 'gm@darvinks.com',
          phone: '+2348077777777',
          role: 'GENERAL_MANAGER',
        },
      },
      systemAdmin: {
        summary: 'Provisioning a System Administrator',
        value: {
          fullName: 'Ngozi Admin',
          email: 'admin@darvinks.com',
          phone: '+2348088888888',
          role: 'SYSTEM_ADMIN',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '✅ Account provisioned — temporary password returned once. Share securely with the new user.',
    schema: {
      example: {
        success: true,
        data: {
          userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          employeeRef: 'Dar-00000006',
          temporaryPassword: 'Xk9#mNpQ2v7B',
          message: 'Account created for Adaeze Okonkwo. A welcome email with login instructions has been sent to adaeze@darvinks.com.',
        },
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '❌ Validation error',
    schema: {
      examples: {
        missingSalesHeadTeam: {
          summary: 'Sales Head without team',
          value: { statusCode: 400, message: 'A Sales Head must be assigned to a team (BRIGHT or RADIANT)', error: 'Bad Request', path: '/api/v1/admin/users/provision', timestamp: '2026-04-15T08:30:00.000Z' },
        },
        missingWarehouseLocation: {
          summary: 'Warehouse Admin without location',
          value: { statusCode: 400, message: 'A Warehouse Administrator must be assigned to a warehouse location', error: 'Bad Request', path: '/api/v1/admin/users/provision', timestamp: '2026-04-15T08:30:00.000Z' },
        },
        fieldStaffRole: {
          summary: 'Attempting to provision a field staff role',
          value: { statusCode: 400, message: 'Role MERCHANDISER cannot be provisioned. Field staff (Tiers 1–4) must self-register via the mobile app.', error: 'Bad Request', path: '/api/v1/admin/users/provision', timestamp: '2026-04-15T08:30:00.000Z' },
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: '❌ Conflict — duplicate email/phone or role slot already filled',
    schema: {
      examples: {
        duplicateEmail: {
          summary: 'Email already registered',
          value: { statusCode: 409, message: 'A user with this email already exists', error: 'Conflict', path: '/api/v1/admin/users/provision', timestamp: '2026-04-15T08:30:00.000Z' },
        },
        salesHeadExists: {
          summary: 'Sales Head slot already filled',
          value: { statusCode: 409, message: 'Team BRIGHT already has an active Sales Head (Chukwuemeka Obi). Deactivate the existing account first.', error: 'Conflict', path: '/api/v1/admin/users/provision', timestamp: '2026-04-15T08:30:00.000Z' },
        },
        warehouseAdminExists: {
          summary: 'Warehouse admin slot already filled',
          value: { statusCode: 409, message: 'Warehouse LAGOS_HQ already has an active admin (Adaeze Okonkwo). Deactivate the existing account first.', error: 'Conflict', path: '/api/v1/admin/users/provision', timestamp: '2026-04-15T08:30:00.000Z' },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: '❌ Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: '❌ Only System Admin can access this endpoint', schema: { example: FORBIDDEN_EXAMPLE } })
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
    description: 'Returns every user in the system — all tiers, teams, and regions — including deactivated accounts. Password hashes are never returned.',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Full user list',
    schema: {
      example: {
        success: true,
        data: [USER_EXAMPLE],
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: '❌ Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: '❌ Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  findAllUsers() {
    return this.adminService.findAllUsers();
  }

  // ─── GET /admin/users/:id ──────────────────────────────────────────────────

  @Get('users/:id')
  @ApiOperation({
    summary: 'Get a single user by ID',
    description: 'Returns the full profile of one user by their UUID.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({
    status: 200,
    description: '✅ User profile returned',
    schema: { example: { success: true, data: USER_EXAMPLE, timestamp: '2026-04-15T08:30:00.000Z' } },
  })
  @ApiResponse({ status: 404, description: '❌ User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: '❌ Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: '❌ Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  findUser(@Param('id') id: string) {
    return this.adminService.findUserById(id);
  }

  // ─── PATCH /admin/users/:id ────────────────────────────────────────────────

  @Patch('users/:id')
  @ApiOperation({
    summary: 'Update a user account',
    description: `
Updates one or more fields on a user account. All fields are optional — only send what needs changing.

**Field rules:**
- \`team\` — only meaningful for Sales Head. Changing team on other roles has no effect.
- \`warehouseLocation\` — only meaningful for Warehouse Admin.
- \`annualTargets\` — merges with existing targets. Format: \`{ "LOTION": 500, "SOAP": 300 }\`.
- \`fcmToken\` — normally updated automatically by the mobile app on login; only set manually if needed.
    `,
  })
  @ApiParam({ name: 'id', description: 'User UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiBody({
    type: UpdateUserDto,
    examples: {
      updateName: {
        summary: 'Update full name',
        value: { fullName: 'Kenny Solape Jr.' },
      },
      updateTargets: {
        summary: 'Update annual targets',
        value: { annualTargets: { LOTION: 600, SOAP: 400, CREAM: 250, MAINTENANCE: 120 } },
      },
      updateWarehouse: {
        summary: 'Reassign warehouse admin to different location',
        value: { warehouseLocation: 'ONITSHA' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '✅ User updated — full updated profile returned',
    schema: {
      example: {
        success: true,
        data: { ...USER_EXAMPLE, fullName: 'Kenny Solape Jr.', updatedAt: '2026-04-16T10:00:00.000Z' },
        timestamp: '2026-04-16T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: '❌ User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: '❌ Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: '❌ Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
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
    description: `
Sets \`isActive: false\` — the user can no longer log in and all active sessions are revoked immediately.

**Use cases:**
- Staff departure or role change
- Security incident
- Before provisioning a replacement Sales Head or Warehouse Admin for the same slot

**Note:** You cannot deactivate your own account via this endpoint.
    `,
  })
  @ApiParam({ name: 'id', description: 'User UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({
    status: 200,
    description: '✅ Account deactivated — all sessions revoked',
    schema: {
      example: {
        success: true,
        data: { ...USER_EXAMPLE, isActive: false, updatedAt: '2026-04-16T10:00:00.000Z' },
        timestamp: '2026-04-16T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '❌ Cannot deactivate — account already inactive or self-deactivation attempt',
    schema: {
      examples: {
        alreadyInactive: {
          summary: 'Already deactivated',
          value: { statusCode: 400, message: "Kenny Solape's account is already deactivated", error: 'Bad Request', path: '/api/v1/admin/users/uuid/deactivate', timestamp: '2026-04-15T08:30:00.000Z' },
        },
        selfDeactivation: {
          summary: 'Trying to deactivate own account',
          value: { statusCode: 400, message: 'You cannot deactivate your own account', error: 'Bad Request', path: '/api/v1/admin/users/uuid/deactivate', timestamp: '2026-04-15T08:30:00.000Z' },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: '❌ User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: '❌ Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: '❌ Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  deactivateUser(
    @Param('id') id: string,
    @CurrentUser() requester: JwtPayload,
  ) {
    return this.adminService.deactivateUser(id, requester);
  }

  // ─── PATCH /admin/users/:id/reactivate ────────────────────────────────────

  @Patch('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a user account',
    description: 'Restores access for a previously deactivated account. The user will need to log in again to get a new token pair.',
  })
  @ApiParam({ name: 'id', description: 'User UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({
    status: 200,
    description: '✅ Account reactivated',
    schema: {
      example: {
        success: true,
        data: { ...USER_EXAMPLE, isActive: true, updatedAt: '2026-04-16T10:00:00.000Z' },
        timestamp: '2026-04-16T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '❌ Account is already active',
    schema: {
      example: { statusCode: 400, message: "Kenny Solape's account is already active", error: 'Bad Request', path: '/api/v1/admin/users/uuid/reactivate', timestamp: '2026-04-15T08:30:00.000Z' },
    },
  })
  @ApiResponse({ status: 404, description: '❌ User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: '❌ Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  reactivateUser(@Param('id') id: string) {
    return this.adminService.reactivateUser(id);
  }

  // ─── POST /admin/users/:id/reset-password ────────────────────────────────

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset a user's password",
    description: `
Generates a new 12-character temporary password, emails it to the user, and:
- Sets \`mustChangePassword: true\` — user must change it on next login
- Revokes **all** active refresh tokens — the user is logged out of all devices

**Use when:** a user forgot their password, their account was compromised, or you need to force a re-login.
    `,
  })
  @ApiParam({ name: 'id', description: 'User UUID', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({
    status: 200,
    description: '✅ Password reset — temporary password emailed, all sessions revoked',
    schema: {
      example: {
        success: true,
        data: { message: 'Password reset email sent to kenny.solape@darvinks.com. All active sessions have been revoked.' },
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: '❌ User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: '❌ Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: '❌ Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  resetUserPassword(@Param('id') id: string) {
    return this.adminService.resetUserPassword(id);
  }

  // ─── GET /admin/provisioned ────────────────────────────────────────────────

  @Get('provisioned')
  @ApiOperation({
    summary: 'List all provisioned back-office accounts',
    description: 'Returns only accounts created via admin provisioning: Sales Head, System Admin, Warehouse Admin, and General Manager. Useful for auditing who created which back-office account.',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Provisioned accounts returned',
    schema: {
      example: {
        success: true,
        data: [
          {
            ...USER_EXAMPLE,
            role: 'WAREHOUSE_ADMIN',
            roleLabel: 'Warehouse Administrator',
            tier: 'TIER5_WAREHOUSE',
            team: null,
            region: null,
            state: null,
            warehouseLocation: 'LAGOS_HQ',
            accountOrigin: 'PROVISIONED',
            mustChangePassword: false,
            provisionedById: 'system-admin-uuid',
          },
        ],
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: '❌ Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: '❌ Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  findProvisionedUsers() {
    return this.adminService.findProvisionedUsers();
  }
  // ── Invite management ──────────────────────────────────────────────────────

  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create and send a registration invite (System Admin only)',
    description:
      'Generates a secure 48-hour invite link and emails it to the specified address. ' +
      'The role, team and warehouse are locked to the invite. ' +
      'Only SALES_HEAD, SYSTEM_ADMIN, WAREHOUSE_ADMIN and GENERAL_MANAGER can be invited.',
  })
  @ApiBody({ type: CreateInviteDto })
  async createInvite(
    @CurrentUser() requester: JwtPayload,
    @Body() dto: CreateInviteDto,
  ) {
    return this.adminService.createInvite(requester, dto);
  }

}