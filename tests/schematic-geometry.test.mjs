import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { intersectRange, linkedSchematicRange, schematicFrame, schematicRegions, projectedRegionLabels } from "../src/schematic-geometry.mjs";
import { createProteinView, rotateProteinView, zoomProteinView, panProteinView, VIEWBOX } from "../src/protein-view.mjs";

const data = JSON.parse(await readFile(new URL("../public/data/variants.json", import.meta.url)));
const regions = schematicRegions(data.protein);
const identity = () => ({ orientation: [0,0,0,1], zoom: 1, pan: [0,0] });
const segmentCounts = frame => frame.reduce((counts, path) => {
  counts[path.regionId] = (counts[path.regionId] || 0) + path.segments; return counts;
}, {});
const drawable = frame => frame.filter(path => path.segments);

test("the schematic uses exact existing major-region bounds and excludes the signal peptide", () => {
  assert.deepEqual(regions.map(({ label, start, end }) => [label, start, end]), [["NC1",17,1253],["Collagenous",1254,2784],["NC2",2785,2944]]);
  assert.equal(regions.length, 3);
  assert.ok(regions.every(region => data.protein.domains.some(domain => domain.id === region.id)));
});

test("subdomains and single-residue focus remain exact when linked to the schematic", () => {
  assert.deepEqual(linkedSchematicRange(data.protein, null, "uniprot-feature-2"), [38,211]);
  assert.deepEqual(linkedSchematicRange(data.protein, [2798,2798], "uniprot-feature-14"), [2798,2798]);
  assert.equal(linkedSchematicRange(data.protein, null, "missing"), null);
  assert.equal(linkedSchematicRange(data.protein, [3000,3010]), null);
  assert.equal(intersectRange([50,20],[1,2944]), null);
  assert.equal(intersectRange([NaN,20],[1,2944]), null);
});

test("arbitrary rotation changes projected geometry while preserving bounded paths and region identities", () => {
  const poses = [createProteinView(), rotateProteinView(createProteinView(), 75, 0), rotateProteinView(createProteinView(), 0, 75), rotateProteinView(createProteinView(), 75, 75)];
  const original = schematicFrame(regions, poses[0]);
  for (const pose of poses) {
    const frame = schematicFrame(regions, pose);
    assert.equal(frame.length, 72);
    assert.deepEqual(frame.map(path => path.key).sort(), original.map(path => path.key).sort());
    assert.deepEqual(segmentCounts(frame), segmentCounts(original));
    assert.ok(frame.every(path => !path.d.includes("NaN") && !path.d.includes("Infinity")));
    assert.ok(frame.filter(path => path.highlighted).every(path => path.d === ""));
    if (pose !== poses[0]) assert.notDeepEqual(frame.map(path => path.d), original.map(path => path.d));
  }
});

test("a residue hover highlights its exact containing region at arbitrary rotations, zoom and pan", () => {
  const base = createProteinView();
  const poses = [base, rotateProteinView(base, 80, 20), rotateProteinView(base, -200, 140),
    panProteinView(zoomProteinView(rotateProteinView(base, 50, 90), 2), 50, -20, {left:0,top:0,width:760,height:460})];
  for (const pose of poses) {
    const highlighted = schematicFrame(regions, pose, [2798,2798]).filter(path => path.highlighted && path.segments > 0);
    assert.ok(highlighted.length > 0);
    assert.ok(highlighted.every(path => path.regionId === "uniprot-feature-20"));
    assert.equal(highlighted.reduce((sum, path) => sum + path.segments, 0), 3);
  }
});

test("boundary-spanning intervals highlight both regions without showing the precursor signal", () => {
  const crossing = schematicFrame(regions, rotateProteinView(createProteinView(), 170, 110), [1253,1254]).filter(path => path.highlighted && path.segments > 0);
  assert.deepEqual([...new Set(crossing.map(path=>path.regionId))].sort(), ["uniprot-feature-14","uniprot-feature-17"]);
  assert.ok(schematicFrame(regions,createProteinView(),[1,16]).filter(path=>path.highlighted).every(path=>path.segments===0));
});

test("end-on rotations reverse domain depth order and keep projected hit-path identities attached", () => {
  const yaw = angle => ({ ...identity(), orientation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)] });
  for (const angle of [Math.PI / 2, -Math.PI / 2]) {
    const frame = drawable(schematicFrame(regions, yaw(angle)));
    assert.ok(frame.every((path, i) => !i || path.z >= frame[i - 1].z - 1e-9));
    assert.equal(frame[0].regionId, angle > 0 ? "uniprot-feature-20" : "uniprot-feature-14");
    assert.equal(frame.at(-1).regionId, angle > 0 ? "uniprot-feature-14" : "uniprot-feature-20");
    assert.ok(frame.every(path => path.key.startsWith(path.regionId) && path.d.startsWith("M")));
  }
});

test("projected domain positions follow the same camera as their paths and fit at the default scale", () => {
  const initial = projectedRegionLabels(regions, identity());
  const halfTurn = projectedRegionLabels(regions, { ...identity(), orientation: [0,0,1,0] });
  assert.ok(initial[0].x < initial[2].x);
  assert.ok(halfTurn[0].x > halfTurn[2].x, "Hit target positions must rotate with the drawn domains");
  assert.deepEqual(initial.map(label => label.id), halfTurn.map(label => label.id));
  for (const pose of [createProteinView(), rotateProteinView(createProteinView(), 190, 0), rotateProteinView(createProteinView(), 0, 190)]) {
    for (const path of drawable(schematicFrame(regions, pose))) {
      const coords = path.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
      for (let i = 0; i < coords.length; i += 2) {
        assert.ok(coords[i] > 0 && coords[i] < VIEWBOX.width);
        assert.ok(coords[i+1] > 0 && coords[i+1] < VIEWBOX.height);
      }
    }
  }
});
