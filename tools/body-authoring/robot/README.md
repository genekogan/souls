# Pip: an agent-authored rolling Soul

Pip is an original small robot body built locally from geometry, with a binocular face, a mustard/cream instrument
panel, two rolling wheels and visible grippers. The authoring script reuses the repository's CC0 Quaternius contact
skeleton and foot-phase data, then supplies its own geometry, still idle, rolling wheel tracks and dance. It uses the
same owner upload contract as other bodies, with no trusted preset registration or new world behavior.

Run from a checkout with its normal dependencies and canonical media pulled:

```sh
node tools/body-authoring/robot/author.mjs \
  mars/viewer/public/modular/environment/animated-casual.glb \
  .local/pip
node --experimental-transform-types --test tools/body-authoring/robot/robot.test.mjs
```

The explicit source is the repository's published `animated-casual.glb`; this example checks its skeleton layout and
is not a general rig converter. The script writes only generated `pip.glb` and `manifest.json` into the chosen output
directory. No generated mesh or recording is committed.

For submission, use an existing paired Soul folder and download the kit advertised by `GET /v1/edge/body` under
`authoring.skill`. Follow that skill's download commands, then:

```sh
node validate.mjs pip.glb manifest.json
node upload.mjs pip.glb manifest.json
node eden-agent.mjs body
node eden-agent.mjs body set <returned-assetId>
```

Use the paired client's ordinary `act dance:here '{"seconds":8}'`, `act stand:here`, `pick-up:<item-id>` and
`put-on:<surface-id>` actions. Uploading and selecting does not grant control of another owner's Soul. Generated
bytes are publicly retrievable for rendering; selection and rediscovery remain owner-private in that world.

## Adapter choices

- **Contract profile:** `humanoid` / `quaternius/1` means the compatible hand/contact rig, not a requirement for visible
  human skin or legs. The canonical leg/foot phase joints remain as rig metadata; the only visible ground contacts
  are the wheels. The world still supplies its existing supported ground navigation and collision model. This does
  not introduce vehicle dynamics, independent wheel steering, flight or stair qualification.
- **Idle:** a quiet standing pose. No inherited human idle gestures. The renderer retains its ordinary breathing/look
  adjustments.
- **Ground movement:** the canonical foot-phase data drives the existing distance-sampled walk clock, scaled to one wheel circumference per cycle, while the
  authored `WheelL`/`WheelR` tracks turn forward without a loop seam. Base mesh remains on the root; visible arms follow the
  contact rig. No animation translates the authoritative root.
- **Dance:** the existing `Dance_Loop` adapter consumes an authored four-second clip. Chest turns +360°; local head
  turns −720° to compensate for its inherited parent turn, giving a −360° world-space head turn. Chassis/wheels stay
  planted. The ordinary action and clip fade own start, interruption and return to idle.
- **Carrying:** visible upper arms, forearms, wrists and gripper jaws are weighted to the canonical contact joints.
  The world's existing item transfer, occupied hand, custody and release paths remain authoritative. A rendered
  object parented to a hand would not by itself prove carrying; qualification also checks receipt and custody state.

Current output: about 440 KB, 6,460 triangles, one mesh/material draw, no images, 64 skin joints and four clips.
The focused test exercises actual renderer fitting, complete opposing turns, stationary base, rolling wheel joints
and the distance between a rendered gripper and its fitted palm. The world journey additionally qualifies pickup,
carrying, release, interruption and reload. Other activities follow the declared rolling profile: compatible adapters are named, and seated, swimming, exercise
or otherwise unqualified physical actions refuse.

## Shared Pip and complete action coverage

Any paired Soul may select the shared core preset with `node eden-agent.mjs body set pip`. Uploads of custom
robot derivatives still use the normal owner submission path. The preset's immutable admitted bytes are generated
lazily from this source, verified against their pinned content hash and shared by requests; no world database blob
is created for a preset selection. Unused worlds do not import the authoring geometry or fetch Pip.

The manifest now declares `actionProfile: "rolling-gripper/1"`. Its versioned disposition is published in the
downloaded authoring contract. Compatible ground travel, conversation, free standing gestures and gripper transfers
use the existing adapters; unsupported or unknown physical actions refuse at discovery, dry-run and native admission.
Sitting, cycling, prone poses, swimming, rides and human eating/drinking are unsupported. Rest, nap and lie requests
are explicitly relabelled as upright standby, on the existing wheel support. This also covers unattended body reflexes.

`Standby_Loop` tucks the forearms inward and lowers the head while the root and wheels stay fixed. Rest requires
free hands; a carried object is retained and the rest request refuses. Standing/waking safely releases standby.
The current shared revision adds this fourth clip: approximately 440 KB, with the same 6,460 triangles, one draw,
no images and 64 skin joints. The additional clip data loads only with a body that uses this revision.
