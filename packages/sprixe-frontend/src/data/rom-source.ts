/**
 * rom-source — translate RomDB records into GameEntry browser cards.
 *
 * Metadata resolution:
 *   1. CPS-1: look up the MAME description in @sprixe/engine's
 *      CPS1_GAME_CATALOG (235 parent + clone entries) and strip the
 *      trailing ROM-code qualifier to get a clean title.
 *   2. Neo-Geo: look up the MAME description in @sprixe/engine's
 *      NEOGEO_GAME_DEFS (auto-generated from MAME neogeo.xml, 178
 *      entries). Same cleanTitle() treatment.
 *   3. If the set is unknown, fall back to the raw id.
 *   4. Publisher is taken from the catalogue entry; CPS-1 is fixed
 *      to "Capcom".
 */

import type { GameEntry, System } from "./games";
import type { RomRecord } from "../storage/rom-db";
import {
  CPS1_GAME_CATALOG,
  type CPS1GameEntry,
} from "@sprixe/engine/game-catalog";
import {
  NEOGEO_GAME_DEFS,
  type NeoGeoGameDef,
} from "@sprixe/engine/memory/neogeo-game-defs";

const cps1Index = new Map<string, CPS1GameEntry>();
for (const entry of CPS1_GAME_CATALOG) cps1Index.set(entry.name, entry);

const neogeoIndex = new Map<string, NeoGeoGameDef>();
for (const def of NEOGEO_GAME_DEFS) neogeoIndex.set(def.name, def);

/**
 * Strip the trailing qualifier from a MAME description. MAME tacks
 * marketing codes ("(NGM-2320)", "(World 910522)") and hardware sub-
 * names ("- Super Vehicle-001", "- Breakers Revenge") onto the pretty
 * title; cleanTitle cuts at the first of those markers so the card
 * reads "Metal Slug" rather than "Metal Slug - Super Vehicle-001".
 */
function cleanTitle(description: string): string {
  const parenIdx = description.indexOf(" (");
  const dashIdx = description.indexOf(" - ");
  const cuts = [parenIdx, dashIdx].filter((i) => i >= 0);
  const end = cuts.length === 0 ? description.length : Math.min(...cuts);
  return description.slice(0, end).trim();
}

/** Extract the year from a MAME description trailer like "(World 900227)" → "1990". */
function extractYear(description: string): string | null {
  const m = description.match(/\((?:[^)]*?)(\d{2})(\d{4})\)/);
  if (!m) return null;
  const yy = parseInt(m[1]!, 10);
  // MAME date prefixes use 2-digit years; 80-99 → 1980s/1990s, 00-29 → 2000s/2020s.
  const century = yy >= 80 ? 1900 : 2000;
  return String(century + yy);
}

/**
 * Map a RomRecord into the GameEntry shape rendered by the browser.
 *
 * Always returns a valid entry — missing metadata falls back to the
 * raw id for title and defaults (Capcom + 1991 for CPS-1, SNK +
 * unknown for Neo-Geo) for the rest.
 */
export function romRecordToGameEntry(record: RomRecord): GameEntry {
  const system: System = record.system;
  if (system === "cps1") {
    const catalog = cps1Index.get(record.id);
    const title = catalog ? cleanTitle(catalog.description) : record.id;
    const year = catalog ? extractYear(catalog.description) ?? "1991" : "1991";
    return {
      id: record.id,
      title,
      year,
      publisher: "Capcom",
      system,
      screenshotUrl: "/media/placeholder-cps1.svg",
      videoUrl: null,
      favorite: record.favorite,
    };
  }

  const def = neogeoIndex.get(record.id);
  return {
    id: record.id,
    title: def ? cleanTitle(def.description) : record.id,
    year: def?.year ?? "1990",
    publisher: def?.publisher ?? "SNK",
    system,
    screenshotUrl: "/media/placeholder-neogeo.svg",
    videoUrl: null,
    favorite: record.favorite,
  };
}
