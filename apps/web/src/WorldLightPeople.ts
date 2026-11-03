import * as THREE from 'three';
import { sampleTake, type TakeFrame } from '../../../mars/viewer/engine/take/replay.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import { projectPlatformFrame } from '../../../mars/viewer/app/engine-view/recorded-platforms.ts';
import type { PlatformFloor } from '../../../mars/viewer/lib/platform-floor.ts';

/** P1 phones: the people view of a new world's first frames, while the people renderer (people-kit.ts: TakePeople and
 *  the Mars viewer's humans, fixtures and components behind it, ~100 KB compressed) is still downloading after the
 *  arrival. It samples the take exactly as TakePeople.show does (platform floors included) and draws nothing: LiveWorld's
 *  stand-ins mark the Souls. LiveWorld swaps in a TakePeople at the same take once the kit has loaded. */
export class WorldLightPeople {
  readonly group = new THREE.Group();
  private platformFloors: readonly PlatformFloor[] = [];
  private platformBaseY = 0;
  private records: { take: Take; all: Record<string, Entity> } | null = null;
  take: Take;
  constructor(take: Take) { this.take = take; }
  setTake(take: Take, _walkOffsets?: Record<string, number>) { this.take = take; }
  show(t: number, _clock?: number, _beat?: unknown, _ahead?: number, _rigBudget?:unknown): TakeFrame {
    const frame = sampleTake(this.take, t);
    if (!this.platformFloors.length) return frame;
    if (this.records?.take !== this.take) this.records = { take: this.take, all: { ...this.take.entities0, ...this.take.finalState.entities } as Record<string, Entity> };
    return projectPlatformFrame(frame, this.records.all, this.platformFloors, this.platformBaseY);
  }
  setPlatformFloors(platforms: readonly PlatformFloor[], baseY = 0) { this.platformFloors = platforms; this.platformBaseY = baseY; }
  setTemplates(_templates: unknown) {}
  setBodyTemplates(_templates: unknown) {}
  setWaterHistory(_takes: readonly Take[]) {}
  setFixtureDrawReplacement(_group: THREE.Group | null, _ids?: readonly string[]) {}
  setSpeaking(_ids: ReadonlySet<string>) {}
  setViewer(_v: unknown) {}
  bodyObject(_id: string): THREE.Object3D | null { return null; }
  obstructionRoots(): readonly THREE.Object3D[] { return []; }
  pickingRoots(): readonly THREE.Object3D[] { return []; }
  async appearancesSettled(_ids?: ReadonlySet<string>) {}
  dispose() {}
}
