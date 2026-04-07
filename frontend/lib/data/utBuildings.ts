/**
 * UT Austin building abbreviation dictionary.
 *
 * Maps the short codes everyone actually uses (GDC, PCL, FAC, …) to the
 * full names that geocoders / OpenStreetMap recognize. Used by:
 *   - geocodeSearch (to expand a query before hitting Nominatim)
 *   - calendar parser (to split "GDC 2.204" into building + room)
 *   - any UI that needs a friendly building name from a code
 *
 * Codes are uppercased keys; aliases (e.g. "GDC", "Gates Computer Science")
 * are listed in `aliases` so the parser can recognize them.
 */

export interface UTBuilding {
  /** Canonical short code, e.g. "GDC" */
  code: string;
  /** Full official name, e.g. "Bill & Melinda Gates Computer Science Complex" */
  fullName: string;
  /** Short, human-friendly name to display in UI when an abbreviation is expanded */
  displayName: string;
  /** Extra search terms to help Nominatim find it */
  searchHint?: string;
  /** Alternate spellings the parser should recognize as this building */
  aliases?: string[];
}

export const UT_BUILDINGS: UTBuilding[] = [
  {
    code: 'GDC',
    fullName: 'Bill & Melinda Gates Computer Science Complex',
    displayName: 'Gates Dell Complex (GDC)',
    // Match OSM / Nominatim; longer "… University of Texas at Austin" queries return [].
    searchHint: 'Bill and Melinda Gates Computer Science Complex, Austin, Texas',
    aliases: ['gdc', 'gates dell', 'gates dell complex', 'gates computer science', 'bill and melinda gates'],
  },
  {
    code: 'PCL',
    fullName: 'Perry-Castañeda Library',
    displayName: 'Perry-Castañeda Library (PCL)',
    searchHint: 'Perry Castaneda Library University of Texas at Austin',
    aliases: ['pcl', 'perry castaneda', 'perry-castaneda', 'perry castañeda', 'pcl library'],
  },
  {
    code: 'FAC',
    fullName: 'Peter T. Flawn Academic Center',
    displayName: 'Flawn Academic Center (FAC)',
    searchHint: 'Peter T Flawn Academic Center University of Texas at Austin',
    aliases: ['fac', 'flawn academic center', 'flawn', 'peter t flawn'],
  },
  {
    code: 'ECJ',
    fullName: 'Ernest Cockrell Jr. Hall',
    displayName: 'Cockrell Jr. Hall (ECJ)',
    searchHint: 'Ernest Cockrell Jr Hall University of Texas at Austin',
    aliases: ['ecj', 'cockrell jr', 'ernest cockrell'],
  },
  {
    code: 'EER',
    fullName: 'Engineering Education and Research Center',
    displayName: 'Engineering Education & Research Center (EER)',
    searchHint: 'Engineering Education and Research Center University of Texas at Austin',
    aliases: ['eer', 'engineering education and research'],
  },
  {
    code: 'ETC',
    fullName: 'Engineering Teaching Center II',
    displayName: 'Engineering Teaching Center (ETC)',
    searchHint: 'Engineering Teaching Center II University of Texas at Austin',
    aliases: ['etc', 'engineering teaching center'],
  },
  {
    code: 'POB',
    fullName: 'Peter O\'Donnell Jr. Building',
    displayName: 'O\'Donnell Building (POB)',
    searchHint: 'Peter O\'Donnell Jr Building University of Texas at Austin',
    aliases: ['pob', 'odonnell', "o'donnell", 'peter odonnell'],
  },
  {
    code: 'WEL',
    fullName: 'Robert A. Welch Hall',
    displayName: 'Welch Hall (WEL)',
    searchHint: 'Robert A Welch Hall University of Texas at Austin',
    aliases: ['wel', 'welch hall', 'welch'],
  },
  {
    code: 'PMA',
    fullName: 'Physics, Math and Astronomy Building',
    displayName: 'Physics Math Astronomy (PMA)',
    searchHint: 'Physics Math Astronomy Building University of Texas at Austin',
    aliases: ['pma', 'physics math astronomy', 'rlm'],
  },
  {
    code: 'MAI',
    fullName: 'Main Building',
    displayName: 'Main Building / UT Tower (MAI)',
    searchHint: 'UT Tower Main Building University of Texas at Austin',
    aliases: ['mai', 'main building', 'ut tower', 'the tower'],
  },
  {
    code: 'JES',
    fullName: 'Jester Center',
    displayName: 'Jester Center (JES)',
    searchHint: 'Jester Center University of Texas at Austin',
    aliases: ['jes', 'jester', 'jester center', 'jester east', 'jester west'],
  },
  {
    code: 'SAC',
    fullName: 'Student Activity Center',
    displayName: 'Student Activity Center (SAC)',
    searchHint: 'Student Activity Center University of Texas at Austin',
    aliases: ['sac', 'student activity center'],
  },
  {
    code: 'UTC',
    fullName: 'University Teaching Center',
    displayName: 'University Teaching Center (UTC)',
    searchHint: 'University Teaching Center University of Texas at Austin',
    aliases: ['utc', 'university teaching center'],
  },
  {
    code: 'GAR',
    fullName: 'Garrison Hall',
    displayName: 'Garrison Hall (GAR)',
    searchHint: 'Garrison Hall University of Texas at Austin',
    aliases: ['gar', 'garrison hall', 'garrison'],
  },
  {
    code: 'BAT',
    fullName: 'Battle Hall',
    displayName: 'Battle Hall (BAT)',
    searchHint: 'Battle Hall University of Texas at Austin',
    aliases: ['bat', 'battle hall'],
  },
  {
    code: 'BUR',
    fullName: 'Burdine Hall',
    displayName: 'Burdine Hall (BUR)',
    searchHint: 'Burdine Hall University of Texas at Austin',
    aliases: ['bur', 'burdine hall', 'burdine'],
  },
  {
    code: 'CAL',
    fullName: 'Calhoun Hall',
    displayName: 'Calhoun Hall (CAL)',
    searchHint: 'Calhoun Hall University of Texas at Austin',
    aliases: ['cal', 'calhoun hall'],
  },
  {
    code: 'PAR',
    fullName: 'Parlin Hall',
    displayName: 'Parlin Hall (PAR)',
    searchHint: 'Parlin Hall University of Texas at Austin',
    aliases: ['par', 'parlin hall', 'parlin'],
  },
  {
    code: 'MEZ',
    fullName: 'Mezes Hall',
    displayName: 'Mezes Hall (MEZ)',
    searchHint: 'Mezes Hall University of Texas at Austin',
    aliases: ['mez', 'mezes hall', 'mezes'],
  },
  {
    code: 'WAG',
    fullName: 'Waggener Hall',
    displayName: 'Waggener Hall (WAG)',
    searchHint: 'Waggener Hall University of Texas at Austin',
    aliases: ['wag', 'waggener hall', 'waggener'],
  },
  {
    code: 'NHB',
    fullName: 'Norman Hackerman Building',
    displayName: 'Hackerman Building (NHB)',
    searchHint: 'Norman Hackerman Building University of Texas at Austin',
    aliases: ['nhb', 'norman hackerman', 'hackerman'],
  },
  {
    code: 'JGB',
    fullName: 'Jackson Geological Sciences Building',
    displayName: 'Jackson Geological Sciences (JGB)',
    searchHint: 'Jackson Geological Sciences Building University of Texas at Austin',
    aliases: ['jgb', 'jackson geological'],
  },
  {
    code: 'CMA',
    fullName: 'Jesse H. Jones Communication Center A',
    displayName: 'Communication Center A (CMA)',
    searchHint: 'Jesse Jones Communication Center A University of Texas at Austin',
    aliases: ['cma', 'communication center a'],
  },
  {
    code: 'CBA',
    fullName: 'College of Business Administration',
    displayName: 'McCombs / CBA',
    searchHint: 'McCombs School of Business University of Texas at Austin',
    aliases: ['cba', 'mccombs', 'college of business'],
  },
  {
    code: 'GSB',
    fullName: 'Graduate School of Business',
    displayName: 'Graduate School of Business (GSB)',
    searchHint: 'McCombs Graduate School of Business University of Texas at Austin',
    aliases: ['gsb'],
  },
  {
    code: 'RLP',
    fullName: 'Patton Hall',
    displayName: 'Patton Hall (RLP)',
    searchHint: 'Patton Hall University of Texas at Austin',
    aliases: ['rlp', 'patton hall'],
  },
  {
    code: 'SZB',
    fullName: 'George I. Sánchez Building',
    displayName: 'Sánchez Building (SZB)',
    searchHint: 'George I Sanchez Building University of Texas at Austin',
    aliases: ['szb', 'sanchez building', 'george sanchez'],
  },
  {
    code: 'GOL',
    fullName: 'Goldsmith Hall',
    displayName: 'Goldsmith Hall (GOL)',
    searchHint: 'Goldsmith Hall University of Texas at Austin',
    aliases: ['gol', 'goldsmith hall'],
  },
  {
    code: 'SUT',
    fullName: 'Sutton Hall',
    displayName: 'Sutton Hall (SUT)',
    searchHint: 'Sutton Hall University of Texas at Austin',
    aliases: ['sut', 'sutton hall'],
  },
  {
    code: 'DFA',
    fullName: 'Doty Fine Arts Building',
    displayName: 'Doty Fine Arts (DFA)',
    searchHint: 'Doty Fine Arts Building University of Texas at Austin',
    aliases: ['dfa', 'doty fine arts'],
  },
  {
    code: 'HRC',
    fullName: 'Harry Ransom Center',
    displayName: 'Harry Ransom Center (HRC)',
    searchHint: 'Harry Ransom Center University of Texas at Austin',
    aliases: ['hrc', 'harry ransom center', 'ransom center'],
  },
  {
    code: 'LBJ',
    fullName: 'Lyndon B. Johnson School of Public Affairs',
    displayName: 'LBJ School',
    searchHint: 'LBJ School of Public Affairs University of Texas at Austin',
    aliases: ['lbj', 'lbj school'],
  },
  {
    code: 'BME',
    fullName: 'Biomedical Engineering Building',
    displayName: 'Biomedical Engineering (BME)',
    searchHint: 'Biomedical Engineering Building University of Texas at Austin',
    aliases: ['bme', 'biomedical engineering'],
  },
];

/**
 * Approximate building entrance / map pin (WGS84). Used to skip Nominatim for
 * known UT codes so calendar deep links resolve instantly and are not rate-limited.
 * OSM-verified where noted; others are campus-scale approximations.
 */
export const UT_BUILDING_ENTRANCES: Partial<
  Record<string, { latitude: number; longitude: number }>
> = {
  GDC: { latitude: 30.2862286, longitude: -97.73658 }, // OSM building centroid
  PCL: { latitude: 30.28314, longitude: -97.73733 },
  FAC: { latitude: 30.28835, longitude: -97.73855 },
  ECJ: { latitude: 30.28902, longitude: -97.73522 },
  EER: { latitude: 30.29025, longitude: -97.73585 },
  ETC: { latitude: 30.28805, longitude: -97.73515 },
  POB: { latitude: 30.28615, longitude: -97.73575 },
  WEL: { latitude: 30.28675, longitude: -97.73785 },
  PMA: { latitude: 30.28892, longitude: -97.73638 },
  MAI: { latitude: 30.28581, longitude: -97.73935 },
  JES: { latitude: 30.28342, longitude: -97.73688 },
  SAC: { latitude: 30.28412, longitude: -97.73405 },
  UTC: { latitude: 30.28868, longitude: -97.73818 },
  GAR: { latitude: 30.28522, longitude: -97.73902 },
  BAT: { latitude: 30.28552, longitude: -97.73962 },
  BUR: { latitude: 30.28982, longitude: -97.73768 },
  CAL: { latitude: 30.28518, longitude: -97.73898 },
  PAR: { latitude: 30.28458, longitude: -97.73868 },
  MEZ: { latitude: 30.28948, longitude: -97.73735 },
  WAG: { latitude: 30.28535, longitude: -97.73758 },
  NHB: { latitude: 30.28542, longitude: -97.73795 },
  JGB: { latitude: 30.28568, longitude: -97.73595 },
  CMA: { latitude: 30.28422, longitude: -97.74185 },
  CBA: { latitude: 30.28415, longitude: -97.73798 },
  GSB: { latitude: 30.28375, longitude: -97.73852 },
  RLP: { latitude: 30.29002, longitude: -97.73845 },
  SZB: { latitude: 30.28112, longitude: -97.73842 },
  GOL: { latitude: 30.28598, longitude: -97.73722 },
  SUT: { latitude: 30.28528, longitude: -97.73155 },
  DFA: { latitude: 30.28592, longitude: -97.73385 },
  HRC: { latitude: 30.28452, longitude: -97.73312 },
  LBJ: { latitude: 30.28155, longitude: -97.73255 },
  BME: { latitude: 30.29138, longitude: -97.73908 },
};

// ---------------------------------------------------------------------------
// Lookup tables (built once at module load)
// ---------------------------------------------------------------------------
const BY_CODE: Map<string, UTBuilding> = new Map(
  UT_BUILDINGS.map((b) => [b.code.toUpperCase(), b]),
);

const BY_ALIAS: Map<string, UTBuilding> = (() => {
  const m = new Map<string, UTBuilding>();
  for (const b of UT_BUILDINGS) {
    m.set(b.code.toLowerCase(), b);
    for (const a of b.aliases ?? []) m.set(a.toLowerCase(), b);
  }
  return m;
})();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Look up a building by code or alias (case-insensitive). */
export function findBuilding(query: string): UTBuilding | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return BY_CODE.get(q.toUpperCase()) ?? BY_ALIAS.get(q) ?? null;
}

/**
 * Expand a building abbreviation in a query string for the geocoder.
 *
 * Examples:
 *   "GDC"  -> "Gates Dell Complex University of Texas at Austin"
 *   "pcl"  -> "Perry Castaneda Library University of Texas at Austin"
 *   "Cane's" -> "Cane's"  (unchanged - not a UT building code)
 */
export function expandBuildingQuery(query: string): string {
  if (!query) return query;
  const trimmed = query.trim();
  const direct = findBuilding(trimmed);
  if (direct) return direct.searchHint ?? direct.fullName;

  // Multi-word query: maybe the first token is an abbreviation followed by a
  // room number (e.g. "GDC 2.204"). Try the first token.
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace > 0) {
    const head = trimmed.slice(0, firstSpace);
    const headMatch = findBuilding(head);
    if (headMatch) return headMatch.searchHint ?? headMatch.fullName;
  }

  return trimmed;
}

/**
 * Parse a free-form location string into building + room components.
 *
 * Recognized patterns:
 *   "GDC 2.204"          -> { building: "GDC",  room: "2.204" }
 *   "GDC - 2.204"        -> { building: "GDC",  room: "2.204" }
 *   "ECJ - Room 0132"    -> { building: "ECJ",  room: "0132"  }
 *   "PCL Library"        -> { building: "PCL",  room: ""      }
 *   "gdc"                -> { building: "GDC",  room: ""      }  (canonicalized)
 *   "Welch Hall 2.224"   -> { building: "WEL",  room: "2.224" }  (alias match)
 *   "Some random place"  -> { building: "Some random place", room: "" }
 */
export function parseLocationString(loc: string): { building: string; room: string } {
  if (!loc || !loc.trim()) return { building: '', room: '' };
  const text = loc.trim();

  // 1. "Room X" / "Rm X" / "# X" prefix anywhere -> split there
  const roomKeywordRe = /(?:^|\s|[-–])\s*(?:room|rm|ste|suite|#)\s*([\w\d.\-]+)/i;
  const kwMatch = text.match(roomKeywordRe);
  if (kwMatch && typeof kwMatch.index === 'number') {
    const room = kwMatch[1];
    const buildingRaw = text
      .slice(0, kwMatch.index)
      .replace(/[-–]\s*$/, '')
      .trim();
    return {
      building: canonicalizeBuilding(buildingRaw || text.replace(kwMatch[0], '').trim()),
      room,
    };
  }

  // 2. " - " or " – " separator -> split on first occurrence
  const dashMatch = text.match(/\s[-–]\s/);
  if (dashMatch && typeof dashMatch.index === 'number') {
    const buildingRaw = text.slice(0, dashMatch.index).trim();
    const roomRaw = text.slice(dashMatch.index + dashMatch[0].length).trim();
    return {
      building: canonicalizeBuilding(buildingRaw),
      room: stripRoomPrefix(roomRaw),
    };
  }

  // 3. Trailing room-number pattern (e.g. "GDC 2.204", "ECJ 0132", "WEL 4.302a")
  const trailRe = /^(.+?)\s+(\d+(?:\.\d+)?[a-z]?|[a-z]?\d+\.\d+[a-z]?)\s*$/i;
  const trailMatch = text.match(trailRe);
  if (trailMatch) {
    return {
      building: canonicalizeBuilding(trailMatch[1].trim()),
      room: trailMatch[2],
    };
  }

  // 4. Whole string might be just a building (alias or full name)
  return { building: canonicalizeBuilding(text), room: '' };
}

/**
 * If the input matches a known UT building code or alias, return the canonical
 * code (e.g. "gdc" -> "GDC", "Welch Hall" -> "WEL"). Otherwise return the input
 * unchanged so unknown buildings still flow through.
 */
export function canonicalizeBuilding(text: string): string {
  if (!text) return text;
  const match = findBuilding(text);
  return match ? match.code : text;
}

/** Strip a leading "Room"/"Rm"/"#" prefix from a room string. */
function stripRoomPrefix(text: string): string {
  return text.replace(/^(?:room|rm|ste|suite|#)\s*/i, '').trim();
}
