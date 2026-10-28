import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { densityBins, mapWindow, markerLayout, validMapRange, mapTicks, positionTracks, regionEvidence } from '../src/map-data.mjs';
const data = JSON.parse(fs.readFileSync(new URL('../public/data/variants.json', import.meta.url)));
const variant = (id, start, end = start, significanceGroup = 'pathogenic') => ({ variationId:id, significanceGroup, proteinMapping:{status:'mapped',start,end} });

test('full protein density counts every mapped variant exactly once', () => {
 const { bins } = densityBins(data.variants, [1, data.protein.length]);
 assert.equal(bins.reduce((n,b)=>n+b.total,0), data.summary.mapped);
 for (const bin of bins) assert.equal(Object.values(bin.counts).reduce((a,b)=>a+b,0),bin.total);
 assert.equal(bins.at(-1).end,data.protein.length);
});
test('zoom retains overlapping intervals at left edge without duplicating them',()=>{
 const vs=[variant(1,10,30),variant(2,22),variant(3,31),variant(4,1,5)];
 const {bins}=densityBins(vs,[20,25],6);
 assert.equal(bins[0].total,1);
 assert.equal(bins[2].total,1);
 assert.equal(bins.reduce((n,b)=>n+b.total,0),2);
 const {markers}=markerLayout(vs,[20,25]);
 assert.equal(markers.length,2);
 assert.equal(markers[0].clippedStart,true);
 assert.equal(markers[0].clippedEnd,true);
 assert.equal(markers[0].variant.proteinMapping.start,10);
});
test('density preview is explicitly bounded while counts retain all records',()=>{
 const {bins}=densityBins(Array.from({length:9},(_,i)=>variant(i,2)),[1,10],1);
 assert.equal(bins[0].samples.length,3);
 assert.equal(bins[0].total,9);
});
test('markers at the same residue or across overlapping intervals occupy separate lanes',()=>{
 const {markers}=markerLayout([variant(2,20),variant(1,20),variant(3,20,40),variant(4,21)],[1,100]);
 assert.deepEqual(markers.map(m=>m.variant.variationId),[1,2,3,4]);
 assert.equal(new Set(markers.map(m=>m.lane)).size,4);
});
test('map window follows range then selected domain and validates inclusive coordinates',()=>{
 const protein={length:100,domains:[{id:'nc',start:20,end:40}]};
 assert.deepEqual(mapWindow(protein,{}),[1,100]);
 assert.deepEqual(mapWindow(protein,{domain:'nc'}),[20,40]);
 assert.deepEqual(mapWindow(protein,{domain:'nc',range:[25,25]}),[25,25]);
 assert.deepEqual(validMapRange('1','100',100),[1,100]);
 for (const r of [[0,5],[4,3],[1,101],['1e1',12],['',10],[1.5,4]]) assert.equal(validMapRange(...r,100),null);
});
test('axis ticks keep both boundaries and do not crowd short windows',()=>{
 assert.deepEqual(mapTicks([25,25]),[25]);
 for(const range of [[1,2944],[2785,2944],[17,18]]) {
  const ticks=mapTicks(range);
  assert.equal(ticks[0],range[0]); assert.equal(ticks.at(-1),range[1]);
  assert.ok(ticks.every(n=>Number.isInteger(n)&&n>=range[0]&&n<=range[1]));
 }
});


test('position tracks account for every mapped variant with one tick per anchor and group',()=>{
 const tracks=positionTracks(data.variants,[1,data.protein.length]);
 assert.equal(tracks.length,5);
 assert.equal(tracks.flatMap(t=>t.points).reduce((n,p)=>n+p.count,0),data.summary.mapped);
 for(const track of tracks){
  assert.equal(new Set(track.points.map(p=>p.position)).size,track.points.length);
  assert.ok(track.points.every(p=>p.position>=1&&p.position<=data.protein.length&&p.count>0&&p.clipped===0));
 }
 const tiny=positionTracks([variant(1,10,25),variant(2,20),variant(3,20,20,'benign'),variant(4,40)],[20,30]);
 assert.deepEqual(tiny.find(t=>t.group==='pathogenic').points,[{position:20,count:2,clipped:1}]);
 assert.deepEqual(tiny.find(t=>t.group==='benign').points,[{position:20,count:1,clipped:0}]);
});

test('region evidence uses exact table membership and bounds example records',()=>{
 const nc2=data.protein.domains.find(d=>d.label==='NC2');
 const preview=regionEvidence(data.variants,nc2);
 assert.equal(preview.total,225);
 assert.equal(preview.start,2785); assert.equal(preview.end,2944);
 assert.equal(preview.samples.length,2);
 assert.ok(preview.samples.every(v=>v.proteinMapping.domainIds.includes(nc2.id)));
 const filtered=data.variants.filter(v=>v.clinicalSignificance.includes('Pathogenic'));
 assert.equal(regionEvidence(filtered,nc2).total,25);
 assert.deepEqual(regionEvidence([],nc2).samples,[]);
});
