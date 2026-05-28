// Maps Nigerian state names to TB DARVINKS regions.
// Region display labels use the exact names from the PRD.

import { Region, Team } from '@prisma/client';

type StateRegionMap = Record<string, Region>;

const BRIGHT_STATE_MAP: StateRegionMap = {
    // North Bright
    kogi: Region.NORTH_BRIGHT,
    adamawa: Region.NORTH_BRIGHT,
    benue: Region.NORTH_BRIGHT,
    taraba: Region.NORTH_BRIGHT,
    // SS1
    abia: Region.SS1,
    'cross river': Region.SS1,
    'akwa ibom': Region.SS1,
    // SS2
    imo: Region.SS2,
    rivers: Region.SS2,
    bayelsa: Region.SS2,
    // SS3
    delta: Region.SS3,
    edo: Region.SS3,
    // SE1
    enugu: Region.SE1,
    ebonyi: Region.SE1,
    anambra: Region.SE1,
};

const RADIANT_STATE_MAP: StateRegionMap = {
    lagos: Region.LAGOS_2,
    fct: Region.NORTH_CENTRAL,
    abuja: Region.NORTH_CENTRAL,
    nasarawa: Region.NORTH_CENTRAL,
    niger: Region.NORTH_CENTRAL,
    plateau: Region.NORTH_CENTRAL,
    kwara: Region.NORTH_CENTRAL,
    kano: Region.NORTH_WEST,
    kaduna: Region.NORTH_WEST,
    sokoto: Region.NORTH_WEST,
    oyo: Region.SOUTH_WEST,
    ogun: Region.SOUTH_WEST,
    osun: Region.SOUTH_WEST,
    ondo: Region.SOUTH_WEST,
    ekiti: Region.SOUTH_WEST,
};

/**
 * Region display labels — exact names from the PRD §7.
 * Used on the ID card and in all UI-facing responses.
 */
export const REGION_DISPLAY_LABEL: Record<Region, string> = {
    [Region.NORTH_BRIGHT]: 'North Bright',
    [Region.SS1]: 'SS1',
    [Region.SS2]: 'SS2',
    [Region.SS3]: 'SS3',
    [Region.SE1]: 'SE1',
    [Region.LAGOS_1]: 'Lagos 1',
    [Region.LAGOS_2]: 'Lagos 2',
    [Region.NORTH_CENTRAL]: 'North Central',
    [Region.NORTH_WEST]: 'North West',
    [Region.SOUTH_WEST]: 'South West',
    [Region.MODERN_TRADE]: 'Modern Trade',
};

/** Resolves a Region from a state name and team. */
export function resolveRegion(state: string, team: Team): Region {
    const normalized = state.trim().toLowerCase();
    if (team === Team.BRIGHT) {
        return BRIGHT_STATE_MAP[normalized] ?? Region.NORTH_BRIGHT;
    }
    return RADIANT_STATE_MAP[normalized] ?? Region.NORTH_CENTRAL;
}

/**
 * Generates a Darvinks employee reference code.
 * Format: Dar-{8-digit zero-padded sequence}
 * e.g. Dar-00000001, Dar-00012345
 */
export function generateEmployeeRef(sequence: number): string {
    return `Dar-${String(sequence).padStart(8, '0')}`;
}