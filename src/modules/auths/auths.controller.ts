
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from './strategies/jwt.strategies';
import { AuthService } from './auths.service';
import { RegisterDto } from './dto/register.dto';
import {
  ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-dto';
import { AdminService } from '../admin/admin.service';
import { RegisterWithInviteDto } from './dto/register-invite.dto';
import {
  AuthTokensResponse,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterResponse,
} from './dto/auth.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { imageFileFilter, MAX_PROFILE_PICTURE_BYTES } from './auths.constant';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly adminService: AdminService,
  ) {}

  // ─── GET /auth/roles ───────────────────────────────────────────────────────

  @Get('roles')
  @ApiOperation({
    summary: 'List all selectable roles',
    description:
      'Returns the complete list of roles available in the registration dropdown. ' +
      'Each role maps to an internal tier automatically — the client never sends a tier directly. ' +
      'Call this endpoint to populate the role picker before showing the registration form.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of roles returned successfully',
    schema: {
      example: {
        success: true,
        data: [
          { role: 'MERCHANDISER', label: 'Merchandiser', description: 'Travel daily to distributor and retail points' },
          { role: 'PROMOTER', label: 'Promoter', description: 'Travel daily to distributor and retail points' },
          { role: 'SALES_REPRESENTATIVE', label: 'Sales Representative', description: 'Responsible for a portfolio of Key Distributors in a sub-region' },
          { role: 'GENERAL_MANAGER', label: 'General Manager', description: 'Highest authority — full strategic and financial oversight' },
        ],
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  getRoles() {
    return this.authService.getAllRoles();
  }

  // ─── POST /auth/register ───────────────────────────────────────────────────

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a new Darvinks user account. ' +
      'The user selects a **role** from the dropdown (call `GET /auth/roles` first). ' +
      'The system automatically assigns the correct **tier** from that role — ' +
      'the client never sends a tier. ' +
      'An employee reference code (`Dar-XXXXXXXX`) is generated automatically. ' +
      'A digital ID card is queued for generation and will be available shortly after registration. ' +
      'The profile picture is optional but recommended — it appears on the ID card.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Registration payload — send as multipart/form-data',
    schema: {
      type: 'object',
      required: ['fullName', 'email', 'phone', 'password', 'role', 'team', 'state', 'dateOfBirth'],
      properties: {
        fullName:      { type: 'string', example: 'Kenny Solape' },
        email:         { type: 'string', format: 'email', example: 'kenny.solape@darvinks.com' },
        phone:         { type: 'string', example: '+2348012345678' },
        password:      { type: 'string', minLength: 8, example: 'SecurePass123!' },
        role:          { type: 'string', enum: ['MERCHANDISER','PROMOTER','DBSR','VSR','SALES_REPRESENTATIVE','SSR','ATSM','TSM','ZONAL_SALES_MANAGER','SALES_HEAD','SYSTEM_ADMIN','WAREHOUSE_ADMIN','GENERAL_MANAGER'], example: 'MERCHANDISER' },
        team:          { type: 'string', enum: ['BRIGHT', 'RADIANT'], example: 'BRIGHT' },
        state:         { type: 'string', example: 'Cross River', description: 'Nigerian state — auto-assigns region' },
        dateOfBirth:   { type: 'string', format: 'date', example: '1995-06-15' },
        annualTargets: { type: 'object', example: { LOTION: 500, SOAP: 300, CREAM: 200, MAINTENANCE: 100 }, description: 'Optional — set by Admin if not provided at registration' },
        profilePicture: { type: 'string', format: 'binary', description: 'Optional profile photo — JPEG or PNG, max 5MB. Appears on ID card.' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    schema: {
      example: {
        success: true,
        data: {
          userId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          employeeRef: 'Dar-00000001',
          message: 'Registration successful. Your digital ID card will be ready shortly.',
        },
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Email or phone number already registered',
    schema: {
      example: {
        statusCode: 409,
        message: 'A user with this email already exists',
        error: 'Conflict',
        path: '/api/v1/auth/register',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed — missing or invalid fields',
    schema: {
      example: {
        statusCode: 400,
        message: ['email must be an email', 'password must be longer than or equal to 8 characters'],
        error: 'Bad Request',
        path: '/api/v1/auth/register',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('profilePicture', {
      limits: { fileSize: MAX_PROFILE_PICTURE_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  async register(
    @Body() dto: RegisterDto,
    @UploadedFile() profilePicture?: Express.Multer.File,
  ): Promise<RegisterResponse> {
    return this.authService.register(dto, profilePicture);
  }

  // ─── POST /auth/login ──────────────────────────────────────────────────────

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login',
    description:
      'Authenticates a user and returns a JWT token pair. ' +
      'The **access token** expires in **12 hours** (covers a full working day). ' +
      'The **refresh token** expires in **30 days**. ' +
      'Store both tokens securely on the device. ' +
      'Use the access token as `Authorization: Bearer <token>` on all protected endpoints. ' +
      'When the access token expires, call `POST /auth/refresh` to get a new pair.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful — token pair returned',
    schema: {
      example: {
        success: true,
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          expiresIn: '12h',
        },
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid email or password',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid email or password',
        error: 'Unauthorized',
        path: '/api/v1/auth/login',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Account deactivated',
    schema: {
      example: {
        statusCode: 401,
        message: 'Your account has been deactivated. Contact your administrator.',
        error: 'Unauthorized',
        path: '/api/v1/auth/login',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  async login(@Body() dto: LoginDto): Promise<AuthTokensResponse> {
    return this.authService.login(dto);
  }

  // ─── POST /auth/refresh ────────────────────────────────────────────────────

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh token',
    description:
      'Exchanges a valid refresh token for a **new access token and a new refresh token**. ' +
      'This is called **token rotation** — the old refresh token is immediately invalidated ' +
      'after this call and cannot be reused. Always store the new refresh token returned. ' +
      '**Security note:** if a previously-used (revoked) refresh token is submitted, ' +
      'the system detects token reuse and revokes ALL sessions for that user as a security measure.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'New token pair issued',
    schema: {
      example: {
        success: true,
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          expiresIn: '12h',
        },
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token is invalid, expired, or already used',
    schema: {
      example: {
        statusCode: 401,
        message: 'Refresh token is no longer valid',
        error: 'Unauthorized',
        path: '/api/v1/auth/refresh',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  async refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokensResponse> {
    return this.authService.refresh(dto.refreshToken);
  }

  // ─── POST /auth/logout ─────────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Logout',
    description:
      'Revokes the provided refresh token, logging the user out of the current device. ' +
      'The access token will remain technically valid until its 12-hour expiry, ' +
      'but the refresh token is immediately invalidated so no new access tokens can be issued. ' +
      'To log out of ALL devices at once, use `POST /auth/change-password` instead.',
  })
  @ApiBody({ type: LogoutDto })
  @ApiResponse({
    status: 204,
    description: 'Logged out successfully — no content returned',
  })
  async logout(@Body() dto: LogoutDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  // ─── POST /auth/change-password ────────────────────────────────────────────

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password',
    description:
      'Changes the authenticated user\'s password. ' +
      'Requires the current password for verification. ' +
      '**All active sessions on all devices are invalidated** after a successful password change — ' +
      'the user will need to log in again on every device. ' +
      'Requires a valid access token in the `Authorization` header.',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 204,
    description: 'Password changed successfully — all sessions invalidated',
  })
  @ApiResponse({
    status: 400,
    description: 'Current password is incorrect, or new password is the same as current',
    schema: {
      example: {
        statusCode: 400,
        message: 'Current password is incorrect',
        error: 'Bad Request',
        path: '/api/v1/auth/change-password',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
        error: 'Unauthorized',
        path: '/api/v1/auth/change-password',
        timestamp: '2026-04-15T08:30:00.000Z',
      },
    },
  })
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.authService.changePassword(
      user.sub,
      dto.currentPassword,
      dto.newPassword,
    );
  }
  // ── Forgot password ────────────────────────────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset OTP',
    description:
      'Sends a 6-digit OTP to the registered email. ' +
      'Always returns 200 regardless of whether the email exists (security).',
  })
  @ApiBody({ type: ForgotPasswordDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If that email is registered, an OTP has been sent.' };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a password reset OTP',
    description: 'Returns { valid: true } if the OTP matches and has not expired.',
  })
  @ApiBody({ type: VerifyOtpDto })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.email, dto.otp);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Reset password using OTP',
    description:
      'Verifies the OTP and sets a new password. ' +
      'All existing refresh tokens are revoked — user must log in again.',
  })
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.email, dto.otp, dto.newPassword);
  }

  // ── Invite-based registration ──────────────────────────────────────────────

  @Get('invite/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate an invite token',
    description:
      'Returns the pre-assigned email, role and team for a valid invite. ' +
      'Mobile app calls this on the registration screen to pre-fill role info.',
  })
  async getInvite(@Param('token') token: string) {
    return this.adminService.getInvite(token);
  }

  @Post('register/invite')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('profilePicture'))
  @ApiOperation({
    summary: 'Register using an invite token (Tier 5 & 6)',
    description:
      'Back-office staff self-register using an invite link sent by the System Admin. ' +
      'Role, team and warehouse are locked to the invite — the user cannot change them.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: RegisterWithInviteDto })
  async registerWithInvite(
    @Body() dto: RegisterWithInviteDto,
    @UploadedFile() profilePicture?: Express.Multer.File,
  ) {
    return this.authService.registerWithInvite(dto, profilePicture);
  }

}