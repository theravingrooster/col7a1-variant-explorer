import { panProteinView, trackballProteinView } from "./protein-view.mjs";

export const ROTATION_DRAG_THRESHOLD = 5;

const finiteVector = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);
const validView = view => view && finiteVector(view.orientation, 4) && Math.hypot(...view.orientation) > 0 &&
  Number.isFinite(view.zoom) && view.zoom > 0 && finiteVector(view.pan, 2);
const copyView = view => ({ orientation: [...view.orientation], zoom: view.zoom, pan: [...view.pan] });

/** Snapshot the camera at pointerdown. All later motion is measured from this
 * pose, so the result does not depend on how often a device sends move events. */
export function startRotationDrag(pointer, view, bounds) {
  if (!pointer || pointer.isPrimary === false || ![0, 2].includes(pointer.button) ||
      ![pointer.pointerId, pointer.clientX, pointer.clientY].every(Number.isFinite) ||
      !validView(view) || !bounds ||
      ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null;
  const startView = copyView(view);
  return {
    pointerId: pointer.pointerId,
    pointerType: pointer.pointerType || "mouse",
    mode: pointer.button === 2 || pointer.ctrlKey || pointer.metaKey ? "pan" : "rotate",
    startX: pointer.clientX,
    startY: pointer.clientY,
    lastX: pointer.clientX,
    lastY: pointer.clientY,
    startView,
    view: copyView(startView),
    bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
    moved: false,
    dragging: false,
    cancelled: false,
  };
}

export function moveRotationDrag(drag, pointer) {
  if (!drag || !pointer || drag.pointerId !== pointer.pointerId ||
      ![pointer.clientX, pointer.clientY].every(Number.isFinite) || drag.cancelled) return drag;
  const dx = pointer.clientX - drag.startX, dy = pointer.clientY - drag.startY;
  const moved = drag.moved || Math.hypot(dx, dy) >= ROTATION_DRAG_THRESHOLD;
  // Direction is intentionally unrestricted, including one-finger vertical
  // movement. Native scrolling remains available outside the viewer surface.
  const dragging = drag.dragging || moved;
  const view = !dragging ? drag.view : drag.mode === "pan"
    ? panProteinView(drag.startView, dx, dy, drag.bounds)
    : trackballProteinView(drag.startView, [drag.startX, drag.startY], [pointer.clientX, pointer.clientY], drag.bounds);
  return { ...drag, lastX: pointer.clientX, lastY: pointer.clientY, moved, dragging, view };
}

export function endRotationDrag(drag, pointer, cancelled = false) {
  if (!drag || (pointer && drag.pointerId !== pointer.pointerId)) return null;
  const final = pointer && !cancelled ? moveRotationDrag(drag, pointer) : drag;
  return {
    view: final.view,
    mode: final.mode,
    dragged: final.dragging,
    suppressClick: cancelled || final.cancelled || final.moved || final.mode === "pan",
    cancelled: cancelled || final.cancelled,
  };
}
