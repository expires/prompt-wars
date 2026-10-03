/** All everyday-object specs, expanded into parts by role. */
import { objParts, OBJ_INFO, type ObjSpec } from './objkit';
import { KITCHEN } from './kitchen';
import { FOOD } from './food';
import { HOUSEHOLD } from './household';
import { OFFICE } from './office';
import { GARDEN } from './garden';
import { SPORTS } from './sports';
import { MUSIC } from './music';
import { TOY } from './toy';
import { WEAPONWORLD } from './weapon';

export const OBJ_SPECS: ObjSpec[] = [...KITCHEN, ...FOOD, ...HOUSEHOLD, ...OFFICE, ...GARDEN, ...SPORTS, ...MUSIC, ...TOY, ...WEAPONWORLD];

export function objectParts() {
  return objParts(OBJ_SPECS);
}

export { OBJ_INFO };
export type { ObjSpec, ObjPartInfo, Role, Swing, Weight, ObjGroup } from './objkit';
