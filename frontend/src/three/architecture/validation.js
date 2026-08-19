// ---------------------------------------------------------------------------
// validation.js
//
// Checks the Building IR for the specific failure modes the master spec
// calls out (floating walls, misaligned floors, stairs that don't reach the
// next level, openings wider than their wall, etc.) and repairs what can be
// repaired automatically. This runs BEFORE geometry generation — the goal
// is that geometryBuilder.js never has to defend against malformed input.
// ---------------------------------------------------------------------------
import { wallLength, normalizeBuilding } from './buildingModel.js';

export function validateBuilding(building) {
  const errors = [];
  const warnings = [];
  const levels = building.levels;

  if (!levels || !levels.length) errors.push('Building has no levels.');

  levels?.forEach((level, li) => {
    if (!level.footprint || level.footprint.length < 3) errors.push(`Level ${level.index}: missing/invalid footprint.`);
    if (!level.walls || !level.walls.length) warnings.push(`Level ${level.index}: has no walls.`);
    if (li > 0) {
      const prev = levels[li - 1];
      if (level.elevation < prev.elevation + prev.height - 0.001) {
        errors.push(`Level ${level.index} overlaps level ${prev.index} (elevation ${level.elevation} < ${prev.elevation + prev.height}).`);
      }
    }
    level.walls?.forEach((wall) => {
      const len = wallLength(wall);
      if (len < 0.05) warnings.push(`Wall ${wall.id}: degenerate (near-zero length).`);
      const openingsWidth = wall.openings.reduce((s, o) => s + o.width, 0);
      if (openingsWidth > len) errors.push(`Wall ${wall.id}: openings (${openingsWidth.toFixed(2)}m) exceed wall length (${len.toFixed(2)}m).`);
      wall.openings.forEach((o) => {
        if (o.offsetAlongWall - o.width / 2 < -0.2 || o.offsetAlongWall + o.width / 2 > len + 0.2) {
          warnings.push(`Opening ${o.id} on wall ${wall.id} extends past the wall end — will be clamped.`);
        }
      });
    });
  });

  building.stairs?.forEach((stair) => {
    const from = levels?.find((l) => l.index === stair.fromFloor);
    const to = levels?.find((l) => l.index === stair.toFloor);
    if (!from || !to) errors.push(`Stair ${stair.id}: references a floor that doesn't exist (${stair.fromFloor} -> ${stair.toFloor}).`);
    else if (to.elevation <= from.elevation) errors.push(`Stair ${stair.id}: destination floor is not above origin floor.`);
  });

  if (levels && levels.length > 1 && (!building.stairs || !building.stairs.length)) {
    warnings.push('Multi-storey building has no stairs connecting floors.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Best-effort auto-repair for the common, mechanically-fixable issues:
// missing defaults, out-of-range opening offsets, unsorted/overlapping
// level elevations. Anything structurally wrong (e.g. a stair pointing at a
// floor that doesn't exist) is left as an error for the caller to surface —
// silently deleting a stair would hide the problem, not fix it.
export function autoRepairBuilding(building) {
  const repaired = normalizeBuilding(building);
  for (const level of repaired.levels) {
    for (const wall of level.walls) {
      const len = wallLength(wall);
      for (const o of wall.openings) {
        const half = o.width / 2;
        if (o.offsetAlongWall - half < 0) o.offsetAlongWall = half + 0.05;
        if (o.offsetAlongWall + half > len) o.offsetAlongWall = Math.max(half + 0.05, len - half - 0.05);
      }
    }
  }
  return repaired;
}
