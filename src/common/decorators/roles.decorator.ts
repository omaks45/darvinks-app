
import { SetMetadata } from '@nestjs/common';
import { UserTier } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restrict a route to one or more user tiers. */
export const Roles = (...roles: UserTier[]) => SetMetadata(ROLES_KEY, roles);