// src/modules/user/user.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
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

  @Get('reports/mine')
  @ApiOperation({ summary: 'List my direct reports' })
  getMyDirectReports(@CurrentUser() user: JwtPayload) {
    return this.usersService.getMyDirectReports(user);
  }

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

  @Delete('reports/:userId')
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a direct-report link' })
  removeDirectReport(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.usersService.removeDirectReport(userId, user);
  }
}