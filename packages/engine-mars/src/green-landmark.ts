import {readFileSync} from 'node:fs';
import {hashOf} from '@souls/engine-contract';
import type {Region} from '../../../mars/viewer/engine/world/types.ts';
const source=JSON.parse(readFileSync(new URL('./fixtures/existing-green-landmark.v1.json',import.meta.url),'utf8'));
/** Matched existing visual source. This region names standing space beside the tree, not its trunk. */
export function existingGreenLandmarkV1(){
 const id='eden-commons-south-tree',point:[number,number]=[4.3,6.5];if(source.proposedLandmarkId!==id||hashOf(source.approach.p)!==hashOf([4.3,0,6.5])||source.existingVisualId!=='commons-canopy-tree-16')throw Error('green-landmark.source-binding');
 const region:Region={id,label:'South commons tree',kind:'place',level:0,polygon:[[4,6.2],[4.6,6.2],[4.6,6.8],[4,6.8]],provenance:{origin:'design-edit',confidence:'hypothetical',note:'Canonical ground approach beside existing commons-canopy-tree-16; visual source remains ornamental'}};
 const regions={[id]:region};return {id,point,regions,source:structuredClone(source),sourceProposalHash:hashOf(source),hash:hashOf({contract:'existing-green-landmark/1',regions,source})};
}
