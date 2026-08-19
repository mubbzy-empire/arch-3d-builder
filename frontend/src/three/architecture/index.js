// ---------------------------------------------------------------------------
// index.js — public entry point for the new architecture engine.
//
// Usage (Phase 1, offline/design-brief path):
//
//   import { generateBuildingFromBrief, buildBuildingGroup } from
//     'three/architecture';
//
//   const building = generateBuildingFromBrief({
//     floors: 2, bedrooms: 4, roofType: 'hip',
//     footprint: { width: 12, depth: 10 },
//     features: { garage: true, compoundWall: true },
//   });
//   const { group, report } = buildBuildingGroup(building);
//   scene.add(group);
//   if (report.warnings.length) console.warn(report.warnings);
// ---------------------------------------------------------------------------
export * from './buildingModel.js';
export * from './materialSystem.js';
export * from './openingSystem.js';
export * from './wallSystem.js';
export * from './roofSystem.js';
export * from './stairSystem.js';
export * from './floorSystem.js';
export * from './validation.js';
export * from './geometryBuilder.js';
export * from './designBriefToBuilding.js';
export * from './constructionAssemblies.js';
export * from './mepLayout.js';
export * from './mepSystem.js';
