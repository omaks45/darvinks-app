import type { File as MulterFile } from 'multer';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import type { JwtPayload } from '@modules/auths/strategies/jwt.strategies';
import { UsersService } from './user.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { imageFileFilter, MAX_PROFILE_PICTURE_BYTES } from '@modules/auths/auths.constant';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.findProfile(user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List users visible to the requesting tier' })
  listVisible(@CurrentUser() user: JwtPayload) {
    return this.usersService.findVisible(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific user profile (visibility enforced)' })
  async getOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    // Tier 1 can only see themselves
    if (user.tier === 'TIER1' && user.sub !== id) {
      return this.usersService.findProfile(user.sub);
    }
    return this.usersService.findById(id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile (phone, profile picture)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('profilePicture', {
      limits: { fileSize: MAX_PROFILE_PICTURE_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
    @UploadedFile() profilePicture?: MulterFile,
  ) {
    return this.usersService.updateProfile(user.sub, dto, profilePicture);
  }
}