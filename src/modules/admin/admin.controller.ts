// src/modules/admin/admin.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CreateInviteDto } from './dto/invite.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApprovalStatus, Region, Team, UserRole, UserTier } from '@prisma/client';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { AdminService } from './admin.service';
import type { FindAllUsersQuery, FindOutOfRegionQuery } from './admin.service';

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
@Roles(UserTier.TIER5_SALES_SUPPORT)
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
  @ApiBody({ type: ProvisionUserDto })
  @ApiResponse({ status: 201, description: 'Account provisioned' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Conflict — duplicate email/phone or role slot already filled' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Only System Admin can access this endpoint', schema: { example: FORBIDDEN_EXAMPLE } })
  async provisionUser(
    @CurrentUser() requester: JwtPayload,
    @Body() dto: ProvisionUserDto,
  ): Promise<ProvisionUserResponse> {
    return this.adminService.provisionUser(requester, dto);
  }

  // ─── GET /admin/users ──────────────────────────────────────────────────────
  //
  // SALES_HEAD callers are automatically scoped to their team — they cannot
  // see users from the other team. The team restriction is applied in the
  // service, not here, so it cannot be bypassed via query params.

  @Get('users')
  @Roles(
    UserTier.TIER5_SALES_SUPPORT,
    UserTier.TIER5_SALES_HEAD,
  )
  @ApiOperation({
    summary: 'List all users with optional filters',
    description: `
Returns users with optional filtering and pagination. Password hashes are never returned.

**Team scoping:** A Sales Head (TIER5_SALES_HEAD) will only ever see users from **their own team**, regardless of any \`?team=\` query param they pass. The restriction is enforced server-side.

**Filter options:**
- \`team\` — filter by team (BRIGHT or RADIANT) — ignored for Sales Head callers
- \`region\` — filter by region code
- \`role\` — filter by exact role enum value
- \`tier\` — filter by tier
- \`search\` — case-insensitive search across full name, email, and employee ref
- \`isActive\` — filter by active status (true / false)
- \`page\` / \`limit\` — pagination (default: page 1, 20 per page; max limit: 100)
    `,
  })
  @ApiQuery({ name: 'team',     required: false, enum: Team,     description: 'Filter by team (ignored for Sales Head — always locked to their team)' })
  @ApiQuery({ name: 'region',   required: false, enum: Region,   description: 'Filter by region' })
  @ApiQuery({ name: 'role',     required: false, enum: UserRole, description: 'Filter by role' })
  @ApiQuery({ name: 'tier',     required: false, enum: UserTier, description: 'Filter by tier' })
  @ApiQuery({ name: 'search',   required: false, type: String,   description: 'Search by name, email, or employee ref' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean,  description: 'Filter by active status' })
  @ApiQuery({ name: 'page',     required: false, type: Number,   description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit',    required: false, type: Number,   description: 'Results per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  findAllUsers(
    @CurrentUser() requester: JwtPayload,
    @Query() query: FindAllUsersQuery,
  ) {
    return this.adminService.findAllUsers(requester, query);
  }

  // ─── GET /admin/users/:id ──────────────────────────────────────────────────

  @Get('users/:id')
  @Roles(
    UserTier.TIER5_SALES_SUPPORT,
    UserTier.TIER5_SALES_HEAD,
  )
  @ApiOperation({
    summary: 'Get a single user by ID',
    description: 'Returns the full profile of one user. Sales Head callers will receive 403 if the user belongs to a different team.',
  })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User profile returned', schema: { example: { success: true, data: USER_EXAMPLE } } })
  @ApiResponse({ status: 403, description: 'Sales Head attempting to view a user outside their team', schema: { example: FORBIDDEN_EXAMPLE } })
  @ApiResponse({ status: 404, description: 'User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  findUser(
    @Param('id') id: string,
    @CurrentUser() requester: JwtPayload,
  ) {
    return this.adminService.findUserById(id, requester);
  }

  // ─── PATCH /admin/users/:id ────────────────────────────────────────────────

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update a user account' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 404, description: 'User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto);
  }

  // ─── PATCH /admin/users/:id/deactivate ────────────────────────────────────

  @Patch('users/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a user account' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Account deactivated' })
  @ApiResponse({ status: 400, description: 'Already inactive or self-deactivation attempt' })
  @ApiResponse({ status: 404, description: 'User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  deactivateUser(
    @Param('id') id: string,
    @CurrentUser() requester: JwtPayload,
  ) {
    return this.adminService.deactivateUser(id, requester);
  }

  // ─── PATCH /admin/users/:id/reactivate ────────────────────────────────────

  @Patch('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a user account' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Account reactivated' })
  @ApiResponse({ status: 400, description: 'Account is already active' })
  @ApiResponse({ status: 404, description: 'User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  reactivateUser(@Param('id') id: string) {
    return this.adminService.reactivateUser(id);
  }

  // ─── POST /admin/users/:id/reset-password ────────────────────────────────

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset a user's password" })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Password reset — temporary password emailed, all sessions revoked' })
  @ApiResponse({ status: 404, description: 'User not found', schema: { example: NOT_FOUND_EXAMPLE } })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  resetUserPassword(@Param('id') id: string) {
    return this.adminService.resetUserPassword(id);
  }

  // ─── GET /admin/provisioned ────────────────────────────────────────────────

  @Get('provisioned')
  @ApiOperation({ summary: 'List all provisioned back-office accounts' })
  @ApiResponse({ status: 200, description: 'Provisioned accounts returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  findProvisionedUsers() {
    return this.adminService.findProvisionedUsers();
  }

  // ── Invite management ──────────────────────────────────────────────────────

  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserTier.TIER5_SALES_SUPPORT,
    UserTier.TIER5_SALES_HEAD,
    UserTier.TIER4,
    UserTier.TIER3,
    UserTier.TIER2,
  )
  @ApiOperation({ summary: 'Create and send a field agent registration invite' })
  @ApiBody({ type: CreateInviteDto })
  @ApiResponse({ status: 201, description: 'Invite created — token emailed to invitee' })
  @ApiResponse({ status: 403, description: 'Caller is not permitted to invite the specified role' })
  @ApiResponse({ status: 409, description: 'An account with that email already exists' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  async createInvite(
    @CurrentUser() requester: JwtPayload,
    @Body() dto: CreateInviteDto,
  ) {
    return this.adminService.createInvite(requester, dto);
  }

  // ─── GET /admin/out-of-region ─────────────────────────────────────────────
  //
  // Returns OutOfRegionRequest records.
  //
  // Access:
  //   TIER5_SALES_SUPPORT — sees all requests
  //   TIER5_SALES_HEAD    — sees only requests from members of their team

  @Get('out-of-region')
  @Roles(
    UserTier.TIER5_SALES_SUPPORT,
    UserTier.TIER5_SALES_HEAD,
  )
  @ApiOperation({
    summary: 'List out-of-region requests',
    description: `
Returns all out-of-region visit requests.

**Access rules:**
- **System Admin (TIER5_SALES_SUPPORT):** sees all requests across both teams.
- **Sales Head (TIER5_SALES_HEAD):** sees only requests submitted by members of **their own team**.

**Filter options:**
- \`status\` — filter by approval status: \`PENDING\`, \`APPROVED\`, or \`REJECTED\`
- \`page\` / \`limit\` — pagination (default: page 1, 20 per page; max: 100)
    `,
  })
  @ApiQuery({ name: 'status', required: false, enum: ApprovalStatus, description: 'Filter by approval status' })
  @ApiQuery({ name: 'page',   required: false, type: Number,         description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit',  required: false, type: Number,         description: 'Results per page (default: 20, max: 100)' })
  @ApiResponse({
    status: 200,
    description: 'Paginated out-of-region requests',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            {
              id: 'req-uuid',
              status: 'PENDING',
              note: 'Need to visit KD account in Lagos 1',
              createdAt: '2026-11-01T09:00:00.000Z',
              updatedAt: '2026-11-01T09:00:00.000Z',
              customer: {
                id: 'cust-uuid',
                businessName: 'Bright Distributors Ltd',
                region: 'LAGOS_1',
                state: 'Lagos',
              },
              requester: {
                id: 'user-uuid',
                fullName: 'Emeka Obi',
                employeeRef: 'Dar-00000012',
                role: 'MERCHANDISER',
                roleLabel: 'Merchandiser',
                team: 'BRIGHT',
                region: 'SS1',
              },
              approver: null,
            },
          ],
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        },
        timestamp: '2026-11-10T10:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token', schema: { example: UNAUTHORIZED_EXAMPLE } })
  @ApiResponse({ status: 403, description: 'Insufficient permissions', schema: { example: FORBIDDEN_EXAMPLE } })
  findOutOfRegionRequests(
    @CurrentUser() requester: JwtPayload,
    @Query() query: FindOutOfRegionQuery,
  ) {
    return this.adminService.findOutOfRegionRequests(requester, query);
  }

  // ─── PATCH /admin/out-of-region/:id/approve ───────────────────────────────

  @Patch('out-of-region/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserTier.TIER5_SALES_SUPPORT,
    UserTier.TIER5_SALES_HEAD,
  )
  @ApiOperation({
    summary: 'Approve an out-of-region request',
    description: 'Marks the request as APPROVED and records the approver. Sales Head can only approve requests from their own team.',
  })
  @ApiParam({ name: 'id', description: 'OutOfRegionRequest UUID' })
  @ApiResponse({ status: 200, description: 'Request approved' })
  @ApiResponse({ status: 400, description: 'Request already resolved' })
  @ApiResponse({ status: 403, description: 'Sales Head attempting to approve a request from another team' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  approveOutOfRegionRequest(
    @Param('id') id: string,
    @CurrentUser() requester: JwtPayload,
    @Body('note') note?: string,
  ) {
    return this.adminService.resolveOutOfRegionRequest(id, requester, 'approve', note);
  }

  // ─── PATCH /admin/out-of-region/:id/reject ────────────────────────────────

  @Patch('out-of-region/:id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserTier.TIER5_SALES_SUPPORT,
    UserTier.TIER5_SALES_HEAD,
  )
  @ApiOperation({
    summary: 'Reject an out-of-region request',
    description: 'Marks the request as REJECTED. Sales Head can only reject requests from their own team.',
  })
  @ApiParam({ name: 'id', description: 'OutOfRegionRequest UUID' })
  @ApiResponse({ status: 200, description: 'Request rejected' })
  @ApiResponse({ status: 400, description: 'Request already resolved' })
  @ApiResponse({ status: 403, description: 'Sales Head attempting to reject a request from another team' })
  @ApiResponse({ status: 404, description: 'Request not found' })
  rejectOutOfRegionRequest(
    @Param('id') id: string,
    @CurrentUser() requester: JwtPayload,
    @Body('note') note?: string,
  ) {
    return this.adminService.resolveOutOfRegionRequest(id, requester, 'reject', note);
  }
}