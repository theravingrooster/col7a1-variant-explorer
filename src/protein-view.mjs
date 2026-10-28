// Camera math for the illustrative protein viewer. No structure data is added.
export const VIEWBOX = Object.freeze({ width: 760, height: 460 });
export const PROTEIN_MODEL_CENTER = Object.freeze([273, 118, 0]);
export const MIN_PROTEIN_ZOOM = 0.55;
export const MAX_PROTEIN_ZOOM = 3.5;
// Keep the model's center inside the viewport even after a long captured drag.
const MAX_PAN = [VIEWBOX.width * .45, VIEWBOX.height * .45];
const EPSILON = 1e-10;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteVector = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const unit = vector => {
  const length = Math.hypot(...vector);
  return length > EPSILON ? vector.map(value => value / length) : [0, 0, 1];
};

export function normalizeProteinOrientation(orientation) {
  if (!finiteVector(orientation, 4)) return [0, 0, 0, 1];
  const length = Math.hypot(...orientation);
  return length > EPSILON ? orientation.map(value => value / length) : [0, 0, 0, 1];
}

export function multiplyProteinOrientations(a, b) {
  const [ax, ay, az, aw] = normalizeProteinOrientation(a);
  const [bx, by, bz, bw] = normalizeProteinOrientation(b);
  return normalizeProteinOrientation([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function axisRotation(axis, radians) {
  const direction = unit(axis), sine = Math.sin(radians / 2);
  return [...direction.map(value => value * sine), Math.cos(radians / 2)];
}

// A modest roll keeps the long axis readable; the initial axial turn separates
// the three illustrative strands. Every later drag composes with this pose.
const INITIAL_ORIENTATION = multiplyProteinOrientations(
  axisRotation([0, 0, 1], -0.075), axisRotation([1, 0, 0], 24 * Math.PI / 180),
);

export function createProteinView() {
  return { orientation: [...INITIAL_ORIENTATION], zoom: 1, pan: [0, 0] };
}

function validView(view) {
  const fallback = createProteinView();
  return {
    orientation: normalizeProteinOrientation(view?.orientation ?? fallback.orientation),
    zoom: clamp(Number.isFinite(view?.zoom) ? view.zoom : 1, MIN_PROTEIN_ZOOM, MAX_PROTEIN_ZOOM),
    pan: finiteVector(view?.pan, 2) ? view.pan.map((value, i) => clamp(value, -MAX_PAN[i], MAX_PAN[i])) : [0, 0],
  };
}

export function rotateProteinVector(vector, orientation) {
  if (!finiteVector(vector, 3)) return [0, 0, 0];
  const q = normalizeProteinOrientation(orientation), xyz = q.slice(0, 3);
  const first = cross(xyz, vector), second = cross(xyz, first);
  return vector.map((value, i) => value + 2 * (q[3] * first[i] + second[i]));
}

export function projectProteinPoint(point, view) {
  const camera = validView(view);
  const local = finiteVector(point, 3) ? point.map((value, i) => value - PROTEIN_MODEL_CENTER[i]) : [0, 0, 0];
  const rotated = rotateProteinVector(local, camera.orientation);
  return { x: VIEWBOX.width / 2 + rotated[0] * camera.zoom + camera.pan[0],
    y: VIEWBOX.height / 2 + rotated[1] * camera.zoom + camera.pan[1], z: rotated[2] };
}

/** Screen-space rotation for keyboard controls and optional automatic motion. */
export function rotateProteinView(view, dx, dy) {
  const camera = validView(view);
  if (![dx, dy].every(Number.isFinite) || Math.hypot(dx, dy) < EPSILON) return camera;
  const rotation = axisRotation([-dy, dx, 0], Math.hypot(dx, dy) * .008);
  return { ...camera, orientation: multiplyProteinOrientations(rotation, camera.orientation) };
}

function validBounds(bounds) {
  return bounds && [bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;
}

function trackballVector(point, bounds) {
  const radius = Math.min(bounds.width, bounds.height) * .45;
  const x = (point[0] - bounds.left - bounds.width / 2) / radius;
  const y = (point[1] - bounds.top - bounds.height / 2) / radius;
  const distance = Math.hypot(x, y);
  // A spherical center and hyperbolic outer surface avoid a hard edge or
  // singularity when a captured pointer moves beyond the viewer rectangle.
  const z = distance < Math.SQRT1_2 ? Math.sqrt(1 - distance * distance) : .5 / distance;
  return unit([x, y, z]);
}

function orientationBetween(from, to) {
  const cosine = clamp(dot(from, to), -1, 1);
  if (cosine > 1 - EPSILON) return [0, 0, 0, 1];
  if (cosine < -1 + EPSILON) {
    const least = from.reduce((index, value, i) => Math.abs(value) < Math.abs(from[index]) ? i : index, 0);
    const basis = [0, 0, 0]; basis[least] = 1;
    return [...unit(cross(from, basis)), 0];
  }
  return normalizeProteinOrientation([...cross(from, to), 1 + cosine]);
}

/** Incremental arcball motion; callers supply the preceding pointer position. */
export function trackballProteinView(view, from, to, bounds) {
  const camera = validView(view);
  if (!finiteVector(from, 2) || !finiteVector(to, 2) || !validBounds(bounds)) return camera;
  const delta = orientationBetween(trackballVector(from, bounds), trackballVector(to, bounds));
  return { ...camera, orientation: multiplyProteinOrientations(delta, camera.orientation) };
}

export function zoomProteinView(view, factor) {
  const camera = validView(view);
  if (!Number.isFinite(factor) || factor <= 0) return camera;
  return { ...camera, zoom: clamp(camera.zoom * factor, MIN_PROTEIN_ZOOM, MAX_PROTEIN_ZOOM) };
}

export function panProteinView(view, dx, dy, bounds) {
  const camera = validView(view);
  if (![dx, dy].every(Number.isFinite) || !validBounds(bounds)) return camera;
  // SVG uses xMidYMid meet. Account for letterboxing rather than stretching
  // horizontal and vertical drag distances by different amounts.
  const unitsPerPixel = Math.max(VIEWBOX.width / bounds.width, VIEWBOX.height / bounds.height);
  return { ...camera, pan: [camera.pan[0] + dx * unitsPerPixel, camera.pan[1] + dy * unitsPerPixel]
    .map((value, i) => clamp(value, -MAX_PAN[i], MAX_PAN[i])) };
}
