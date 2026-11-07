# Juniper: a compact centaur foal

Juniper is an original compact centaur built locally from geometry. It has a chestnut horse body with white socks
and a green-vested torso with bare arms and a ponytail. The script reuses the repository's CC0 Quaternius contact
skeleton and its Idle and Walk clips, then adds its own geometry, two hind-leg chains, a standing dance and an upright
standby. The manifest declares `actionProfile: "quadruped-torso/1"`; see the body-authoring skill for what that
profile allows and refuses.

```sh
node tools/body-authoring/centaur/author.mjs \
  mars/viewer/public/modular/environment/animated-casual.glb \
  .local/centaur
node --experimental-transform-types --test tools/body-authoring/centaur/centaur.test.mjs   # Node 24: the renderer check
node --test apps/server/src/edge-body-centaur.test.ts
```

How it is built:

- **Legs.** The canonical legs are the forelegs. `HindUpperLeg`, `HindLowerLeg` (under `Body`) and `HindFoot` (under
  `Root`) sit 0.24 m behind them. In each clip, a hind leg replays its same-side foreleg's track half a stride later.
  As a result, left fore with right hind, and right fore with left hind, move together. There is no solver,
  retargeting or foot IK.
- **Footprint.** The horse body is foal-sized and stands square: the pelvis and legs hold their bind pose in Idle
  instead of the canonical human's staggered stance. As the renderer stands it (its Idle pose, centred and fitted),
  everything below the hips in Idle, standby and dance fits the 0.28 m humanoid navigation disc. That disc is the world's
  support and collision footprint, and admission checks those poses (`body.footprint`). The walk's stride swings the
  hooves beyond the disc mid-step, as a humanoid's feet do. `authorCentaur({hindOffset:.45})` makes a longer variant
  that admission refuses.
- **Hands.** The torso, arms and hands are the canonical ones. Pick-up, carry and put-down use the world's existing hand
  adapters and real custody.
- **Rest and dance.** Rest is an upright standby on the same four hooves. The dance sways the torso and pumps the arms
  in place.

Honest limits:

- The hooves are visual. The world supports and collides with the disc, not four feet, so the hind hooves are not
  placed on slopes or steps. Supported terrain is the ordinary walkable ground a humanoid uses.
- Seats, prone poses, swimming, rides, mounting, passengers, paired contact acts and running gaits are refused.
- The shared core preset `centaur` is built lazily from this source and pinned by asset id
  (`apps/server/src/edge/body/shared-bodies.ts`). A change to the source gives a new asset id and a new preset revision.
