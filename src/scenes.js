// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// A refused command (unknown device, value out of range, evcc unreachable or
// refusing) throws: the action fails, the scene goes on and Gladys logs the
// coded message. The triggers are fired by the hub from evcc's own state
// (src/events.js), so a mode set here also fires `mode_changed`.
// -----------------------------------------------------------------------------

import { MODES } from './evcc/model.js';

export const LIMIT_TYPES = ['soc', 'energy'];

export const SCENE_ACTIONS = {
  async set_mode(hub, { fields }) {
    if (!MODES.includes(fields.mode)) {
      throw new Error(`Unknown mode ${fields.mode}`);
    }
    await hub.setMode(fields.device, fields.mode);
  },

  async set_limit(hub, { fields }) {
    const type = fields.limit_type ?? 'soc';
    if (!LIMIT_TYPES.includes(type)) {
      throw new Error(`Unknown limit type ${type}`);
    }
    await hub.setLimit(fields.device, type, fields.value);
  },
};
