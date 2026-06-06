
// Maps user-facing roles (what the registration UI shows) to internal tiers.
// This is the single source of truth for the role → tier relationship.
//
// The user picks a ROLE at registration (human-readable).
// The system assigns a TIER internally (for access control).
// The ID card displays the role label, not the tier enum.

import { UserTier } from '@prisma/client';

// ─── Role enum ────────────────────────────────────────────────────────────────
// These are the exact role names shown in the registration UI dropdown.

export enum UserRole {
    MERCHANDISER        = 'MERCHANDISER',
    PROMOTER            = 'PROMOTER',
    DBSR                = 'DBSR',          // Direct Business Sales Representative
    VSR                 = 'VSR',           // Van Sales Representative
    SALES_REPRESENTATIVE = 'SALES_REPRESENTATIVE',
    SSR                 = 'SSR',           // Senior Sales Representative
    ATSM                = 'ATSM',          // Assistant Territorial Sales Manager
    TSM                 = 'TSM',           // Territorial Sales Manager
    ZONAL_SALES_MANAGER = 'ZONAL_SALES_MANAGER',
    SALES_HEAD          = 'SALES_HEAD',
    SYSTEM_ADMIN        = 'SYSTEM_ADMIN',
    WAREHOUSE_ADMIN     = 'WAREHOUSE_ADMIN',
    GENERAL_MANAGER     = 'GENERAL_MANAGER',
}

// ─── Role metadata ────────────────────────────────────────────────────────────

interface RoleMeta {
    tier: UserTier;
    label: string;         // Display label shown on ID card and UI
    description: string;   // Short description shown in registration dropdown
}

export const ROLE_META: Record<UserRole, RoleMeta> = {
    [UserRole.MERCHANDISER]: {
        tier: UserTier.TIER1,
        label: 'Merchandiser',
        description: 'Travel daily to distributor and retail points',
    },
    [UserRole.PROMOTER]: {
        tier: UserTier.TIER1,
        label: 'Promoter',
        description: 'Travel daily to distributor and retail points',
    },
    [UserRole.DBSR]: {
        tier: UserTier.TIER1,
        label: 'DBSR',
        description: 'Direct Business Sales Representative',
    },
    [UserRole.VSR]: {
        tier: UserTier.TIER1,
        label: 'VSR',
        description: 'Van Sales Representative',
    },
    [UserRole.SALES_REPRESENTATIVE]: {
        tier: UserTier.TIER2,
        label: 'Sales Representative',
        description: 'Responsible for a portfolio of Key Distributors in a sub-region',
    },
    [UserRole.SSR]: {
        tier: UserTier.TIER2,
        label: 'Senior Sales Representative',
        description: 'Responsible for a portfolio of Key Distributors in a sub-region',
    },
    [UserRole.ATSM]: {
        tier: UserTier.TIER3,
        label: 'ATSM',
        description: 'Assistant Territorial Sales Manager',
    },
    [UserRole.TSM]: {
        tier: UserTier.TIER3,
        label: 'Territorial Sales Manager',
        description: 'Overseeing multiple SRs across a defined territory',
    },
    [UserRole.ZONAL_SALES_MANAGER]: {
        tier: UserTier.TIER4,
        label: 'Zonal Sales Manager',
        description: 'Responsible for an entire zone comprising multiple territories',
    },
    [UserRole.SALES_HEAD]: {
        tier: UserTier.TIER5_SALES_HEAD,
        label: 'Sales Head',
        description: 'Executive oversight with the broadest day-to-day platform access',
    },
    [UserRole.SYSTEM_ADMIN]: {
        tier: UserTier.TIER5_SYSTEM_ADMIN,
        label: 'System Administrator',
        description: 'Operational gatekeeper — approves POs, manages users',
    },
    [UserRole.WAREHOUSE_ADMIN]: {
        tier: UserTier.WAREHOUSE_ADMIN,
        label: 'Warehouse Administrator',
        description: 'Custodian of stock records at a warehouse location',
    },
    [UserRole.GENERAL_MANAGER]: {
        tier: UserTier.TIER6_GM,
        label: 'General Manager',
        description: 'Highest authority — full strategic and financial oversight',
    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the UserTier for a given role. */
export function tierFromRole(role: UserRole): UserTier {
    return ROLE_META[role].tier;
}

/** Returns the display label for a given role (used on ID card). */
export function labelFromRole(role: UserRole): string {
    return ROLE_META[role].label;
}

/**
 * Returns all roles as an array — used to populate the
 * registration dropdown on the mobile/web client.
 */
export function getAllRoles(): Array<{ role: UserRole; label: string; description: string }> {
    return Object.values(UserRole).map((role) => ({
        role,
        label: ROLE_META[role].label,
        description: ROLE_META[role].description,
    }));
}