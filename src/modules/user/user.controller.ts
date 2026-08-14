// src/modules/user/user.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { UsersService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { FindUserToLinkDto, AddDirectReportDto } from './dto/add-direct-report.dto';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiResponse({ status: 200, description: 'Authenticated user\'s own profile. idCardUrl will be null for a few seconds after first registration while the card generates in the background — poll this endpoint until it is populated.', schema: { example: { success: true, data: { id: 'user-id', employeeRef: 'Dar-00000007', fullName: 'Kenny Solape', email: 'rep@darvinks.com', phone: '+2348011111111', role: 'SALES_REPRESENTATIVE', roleLabel: 'Sales Representative', tier: 'TIER2', team: 'RADIANT', region: 'SOUTH_WEST', state: 'lagos', profilePictureUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../photo.jpg', idCardUrl: 'https://res.cloudinary.com/dwiouwwom/image/upload/v.../Dar-00000007.pdf', isActive: true, accountOrigin: 'SELF_REGISTERED', createdAt: '2026-07-24T20:02:00.000Z' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get('me')
  @ApiOperation({ summary: "Get the current user's own profile" })
  getMyProfile(@CurrentUser() user: JwtPayload) {
    return this.usersService.findProfile(user.sub);
  }

  @Patch('me')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: "Update the current user's profile" })
  @UseInterceptors(FileInterceptor('profilePicture'))
  updateMyProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() profilePicture?: Express.Multer.File,
  ) {
    return this.usersService.updateProfile(user.sub, dto, profilePicture);
  }

  @Get()
  @ApiOperation({
    summary: 'List visible users',
    description: 'Admin tiers see everyone. Others see their own team, scoped to tiers at or below their own.',
  })
  findVisible(@CurrentUser() user: JwtPayload) {
    return this.usersService.findVisible(user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Get a single user by ID' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findById(id);
  }

  // ── Direct-report linking ───────────────────────────────────────────────

  @ApiResponse({ status: 200, description: 'Search for a user to link as a direct report. Search by employeeRef, fullName, or phone.', schema: { example: { success: true, data: [{ id: 'user-id', employeeRef: 'Dar-00000003', fullName: 'Emeka ZSM', tier: 'TIER4', team: 'RADIANT', region: 'SOUTH_WEST', isActive: true }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get('reports/search')
  @ApiOperation({
    summary: 'Search for a user to add as a direct report',
    description:
      'Search by employeeRef, phone, or email. Used before calling ' +
      'POST /users/reports/:userId — find the right person first.',
  })
  findUserToLink(@Query() query: FindUserToLinkDto) {
    return this.usersService.findUserToLink(query);
  }

  @ApiResponse({ status: 200, description: 'List of users who directly report to the authenticated user. Sales Head gets their Tier4 ZSMs; ZSM gets their Tier3 ATSMs; etc.', schema: { example: { success: true, data: [{ id: 'user-id', employeeRef: 'Dar-00000003', fullName: 'Emeka ZSM', email: 'zsm@darvinks.com', phone: '08033333331', tier: 'TIER4', team: 'RADIANT', region: 'SOUTH_WEST', isActive: true }], timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Get('reports/mine')
  @ApiOperation({ summary: 'List my direct reports' })
  getMyDirectReports(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMyDirectReports(user);
  }

  @ApiResponse({ status: 200, description: 'User linked as direct report. Manager can only link users from the same team who are exactly one tier below.', schema: { example: { success: true, data: { id: 'user-id', employeeRef: 'Dar-00000003', fullName: 'Emeka ZSM', tier: 'TIER4', team: 'RADIANT', reportsToId: 'sh-id', isActive: true }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 400, description: 'Wrong tier, different team, already linked, or deactivated', schema: { example: { success: false, statusCode: 400, message: 'Team mismatch: you are on team RADIANT but Emeka ZSM is on team BRIGHT. A manager can only link agents within their own team.', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 404, description: 'User not found', schema: { example: { success: false, statusCode: 404, message: 'User user-id not found', error: 'Not Found', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Post('reports/:userId')
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiOperation({
    summary: 'Link a user as my direct report',
    description:
      'The target user must be exactly one tier below the requester ' +
      '(e.g. a Tier4 can link a Tier3, not a Tier2 or Tier1 directly).',
  })
  addDirectReport(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.addDirectReport(userId, user);
  }

  @ApiResponse({ status: 200, description: 'Direct report link removed. The user\'s reportsToId is set back to null.', schema: { example: { success: true, data: { message: 'Direct report removed successfully' }, timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized', schema: { example: { success: false, statusCode: 401, message: 'Unauthorized', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @ApiResponse({ status: 404, description: 'User not found', schema: { example: { success: false, statusCode: 404, message: 'User not found', error: 'Not Found', timestamp: '2026-07-29T12:00:00.000Z' } } })
  @Delete('reports/:userId')
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a direct-report link' })
  removeDirectReport(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.removeDirectReport(userId, user);
  }

  // ── FCM Push Token ────────────────────────────────────────────────────────────

  @Post('me/fcm-token')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Register device FCM token for push notifications',
    description:
      'Call this immediately after every login to register the device\'s ' +
      'Firebase Cloud Messaging token. Without this, the user will not receive ' +
      'any push notifications (PO approvals, target assignments, etc.). ' +
      'The token changes when the app is reinstalled — always call this on login. ' +
      '\n\nFlutter: `FirebaseMessaging.instance.getToken()`' +
      '\n\nReact Native: `messaging().getToken()`',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fcmToken'],
      properties: {
        fcmToken: {
          type:        'string',
          description: 'Firebase Cloud Messaging registration token from the device',
          example:     'cRlN8...:APA91b...',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'FCM token registered — push notifications will now work on this device',
    schema: {
      example: {
        success:   true,
        data:      { message: 'Push notifications enabled for this device' },
        timestamp: '2026-08-11T08:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerFcmToken(
    @Body('fcmToken') fcmToken: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.usersService.registerFcmToken(user.sub, fcmToken);
    return { message: 'Push notifications enabled for this device' };
  }

  @Delete('me/fcm-token')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Unregister FCM token on logout',
    description:
      'Call this when the user logs out to stop push notifications reaching ' +
      'this device. The app should call this before clearing the auth tokens.',
  })
  @ApiResponse({
    status: 200,
    description: 'FCM token cleared — push notifications disabled for this device',
    schema: {
      example: {
        success:   true,
        data:      { message: 'Push notifications disabled for this device' },
        timestamp: '2026-08-11T08:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unregisterFcmToken(@CurrentUser() user: JwtPayload) {
    await this.usersService.unregisterFcmToken(user.sub);
    return { message: 'Push notifications disabled for this device' };
  }
}