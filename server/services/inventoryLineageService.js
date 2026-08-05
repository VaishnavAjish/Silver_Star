'use strict';

/**
 * Unified Inventory Lineage Service.
 *
 * All inventory creations that derive from an existing parent lot MUST use
 * this helper to populate the canonical lineage fields:
 * - root_lot_id
 * - genealogy_path
 * - split_level
 */
function generateLineage(parentLot) {
  if (!parentLot) {
    return {
      root_lot_id: null,
      genealogy_path: null,
      split_level: 0
    };
  }

  // 1. root_lot_id: Inherit from parent, or if parent has none, the parent itself is the root.
  const rootLotId = parentLot.root_lot_id || parentLot.id;

  // 2. genealogy_path: Append the parent's id to the parent's genealogy path.
  let newPath = parentLot.id.toString();
  if (parentLot.genealogy_path && parentLot.genealogy_path.trim() !== '') {
    newPath = `${parentLot.genealogy_path},${parentLot.id}`;
  }

  // 3. split_level: Increment the parent's split level.
  const splitLevel = (parseInt(parentLot.split_level, 10) || 0) + 1;

  return {
    root_lot_id: rootLotId,
    genealogy_path: newPath,
    split_level: splitLevel
  };
}

module.exports = {
  generateLineage
};
