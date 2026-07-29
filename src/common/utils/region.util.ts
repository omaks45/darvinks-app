
// Maps Nigerian state names to TB DARVINKS regions.
// Region display labels use the exact names from the PRD.
//
// LAGOS CHANGE (July 2026):
// LAGOS_1 and LAGOS_2 have been merged into SOUTH_WEST — Lagos state is
// geographically part of South West Nigeria and is now treated as one
// unified territory. Both enum values remain in the schema for backwards
// compatibility with any historical rows; all new registrations from
// 'lagos' state produce SOUTH_WEST. Existing LAGOS_1/LAGOS_2 rows are
// backfilled via migration script prisma/migrations/backfill-lagos-region.ts

import { Region, Team } from '@prisma/client';

type StateRegionMap = Record<string, Region>;

const BRIGHT_STATE_MAP: StateRegionMap = {
    // North Bright
    kogi:         Region.NORTH_BRIGHT,
    adamawa:      Region.NORTH_BRIGHT,
    benue:        Region.NORTH_BRIGHT,
    taraba:       Region.NORTH_BRIGHT,
    // SS1
    abia:         Region.SS1,
    'cross river': Region.SS1,
    'akwa ibom':  Region.SS1,
    // SS2
    imo:          Region.SS2,
    rivers:       Region.SS2,
    bayelsa:      Region.SS2,
    // SS3
    delta:        Region.SS3,
    edo:          Region.SS3,
    // SE1
    enugu:        Region.SE1,
    ebonyi:       Region.SE1,
    anambra:      Region.SE1,
};

const RADIANT_STATE_MAP: StateRegionMap = {
    // Lagos now maps to SOUTH_WEST — merged from LAGOS_1/LAGOS_2
    lagos:        Region.SOUTH_WEST,
    fct:          Region.NORTH_CENTRAL,
    abuja:        Region.NORTH_CENTRAL,
    nasarawa:     Region.NORTH_CENTRAL,
    niger:        Region.NORTH_CENTRAL,
    plateau:      Region.NORTH_CENTRAL,
    kwara:        Region.NORTH_CENTRAL,
    kano:         Region.NORTH_WEST,
    kaduna:       Region.NORTH_WEST,
    sokoto:       Region.NORTH_WEST,
    oyo:          Region.SOUTH_WEST,
    ogun:         Region.SOUTH_WEST,
    osun:         Region.SOUTH_WEST,
    ondo:         Region.SOUTH_WEST,
    ekiti:        Region.SOUTH_WEST,
};

export const REGION_DISPLAY_LABEL: Record<Region, string> = {
    [Region.NORTH_BRIGHT]: 'North Bright',
    [Region.SS1]:          'SS1',
    [Region.SS2]:          'SS2',
    [Region.SS3]:          'SS3',
    [Region.SE1]:          'SE1',
    [Region.LAGOS_1]:      'Lagos 1',     // deprecated — kept for display compat
    [Region.LAGOS_2]:      'Lagos 2',     // deprecated — kept for display compat
    [Region.NORTH_CENTRAL]:'North Central',
    [Region.NORTH_WEST]:   'North West',
    [Region.SOUTH_WEST]:   'South West',
    [Region.MODERN_TRADE]: 'Modern Trade',
};

export function resolveRegion(state: string, team: Team): Region {
    const normalized = state.trim().toLowerCase();
    if (team === Team.BRIGHT) {
        return BRIGHT_STATE_MAP[normalized] ?? Region.NORTH_BRIGHT;
    }
    return RADIANT_STATE_MAP[normalized] ?? Region.NORTH_CENTRAL;
}

/**
 * Resolves the TRUE region for a given state regardless of team.
 * Used when validating GPS coordinates against an agent's region —
 * we must check what region the state actually belongs to, not what
 * the agent's team would default to. This prevents a BRIGHT agent
 * from registering a Lagos KD because resolveRegion('lagos', 'BRIGHT')
 * would incorrectly fall back to NORTH_BRIGHT (the BRIGHT default)
 * instead of SOUTH_WEST (where Lagos actually is).
 */
export function resolveActualRegionForState(state: string): Region | null {
    const normalized = state.trim().toLowerCase();
    // Check BRIGHT states first
    if (BRIGHT_STATE_MAP[normalized]) return BRIGHT_STATE_MAP[normalized];
    // Then RADIANT states
    if (RADIANT_STATE_MAP[normalized]) return RADIANT_STATE_MAP[normalized];
    // State not found in either map
    return null;
}

export function generateEmployeeRef(sequence: number): string {
    return `Dar-${String(sequence).padStart(8, '0')}`;
}