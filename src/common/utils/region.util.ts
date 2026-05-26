// Maps Nigerian state names to TB DARVINKS regions.
// Used at registration to auto-assign a user's region from their state.

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
    'rivers': Region.SS2,
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
    // Lagos sub-regions — further split by the user's LGA/area at registration
    lagos: Region.LAGOS_2, // default; override to LAGOS_1 for Trade Fair area
    // North Central
    'fct': Region.NORTH_CENTRAL,
    abuja: Region.NORTH_CENTRAL,
    nasarawa: Region.NORTH_CENTRAL,
    niger: Region.NORTH_CENTRAL,
    plateau: Region.NORTH_CENTRAL,
    kwara: Region.NORTH_CENTRAL,
    // North West
    kano: Region.NORTH_WEST,
    kaduna: Region.NORTH_WEST,
    sokoto: Region.NORTH_WEST,
    // South West
    oyo: Region.SOUTH_WEST,
    ogun: Region.SOUTH_WEST,
    osun: Region.SOUTH_WEST,
    ondo: Region.SOUTH_WEST,
    ekiti: Region.SOUTH_WEST,
};

/**
 * Resolves a Region from a state name and team.
 * Falls back to a sensible default if the state isn't explicitly mapped.
 * Modern Trade is a channel, not a geographic region — assigned explicitly.
 */
export function resolveRegion(state: string, team: Team): Region {
    const normalized = state.trim().toLowerCase();

    if (team === Team.BRIGHT) {
        return BRIGHT_STATE_MAP[normalized] ?? Region.NORTH_BRIGHT;
    }

    return RADIANT_STATE_MAP[normalized] ?? Region.NORTH_CENTRAL;
}

/**
 * Generates a human-readable employee reference code.
 * Format: DRV-{TEAM_PREFIX}-{zero-padded sequence}
 * e.g. DRV-BRT-0042, DRV-RAD-0007
 */
export function generateEmployeeRef(team: Team, sequence: number): string {
    const prefix = team === Team.BRIGHT ? 'BRT' : 'RAD';
    const seq = String(sequence).padStart(4, '0');
    return `DRV-${prefix}-${seq}`;
}