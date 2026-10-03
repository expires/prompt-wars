export * from './types';
export { PARTS, getPart, registerParts, catalog, catalogForClass, partsByCategory, registry, toCatalogEntry } from './registry';
export { assembleWeapon, assembleParts, DEFAULT_AXIS, SOCKET_ALIASES } from './assemble';
export { RECIPES, getRecipe } from './recipes';
export { countTris, getMaterial, Kit } from './lib/kit';
export {
  allTemplates,
  getTemplate,
  searchTemplates,
  templatesForClass,
  randomTemplate,
  templateToRecipe,
  templateStats,
  encodeTemplates,
  decodeTemplates,
  THEMES,
} from './templates';
export type { Template, SearchOpts, MeleeMeta, StatHints, FireMode, Swing, MeleeWeight, Theme } from './templates';
export { OBJ_SPECS, OBJ_INFO } from './gen/obj';
