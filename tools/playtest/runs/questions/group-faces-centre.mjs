// Question (#423 social facing): while three Souls read together, does each face the group's centre? Read from the
// seats' own `here` calls during the read (me.pos, me.heading in integer compass degrees, me.activity): the world's
// answer to each Soul, not the seat's claim. Without three reading Souls' samples the answer is unknown.
const compass = (dx, dz) => ((Math.atan2(dx, -dz) * 180 / Math.PI) % 360 + 360) % 360;
const off = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
const xz = (p) => (Array.isArray(p) ? [p[0], p.at(-1)] : p && Number.isFinite(p.x) ? [p.x, p.z] : null);
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
// A guest's program is its `accept`; what its body does is `actualActivity`.
const reading = (me) => /read/.test(String(me?.actualActivity?.kind ?? me?.activity?.kind ?? me?.activity ?? ''));
export default {
  id: 'group-faces-centre',
  version: 3,
  question: 'In every `here` sample while all three Souls read together, is each heading within 5 degrees of the direction to the group\'s centre?',
  assumptions: [
    '`here` (me.pos, me.heading as integer compass degrees) is the world\'s own view of each body. Its rounding is allowed on top of the 5 degree bound: 0.5 degrees of heading, plus the angle that 0.05 m of rounding in each coordinate of the Soul\'s position and of the centre can make at that distance (reported per sample).',
    'The centre is the centroid of each Soul\'s median reading position (a standing group does not move while reading).',
    'Samples come from director cards several seconds after both guests accepted, so the 2 s settling time has passed.',
  ],
  score(ctx) {
    const rows = ctx.seats.map((seat) => ({ seat, steps: ctx.steps(seat).filter((x) => x.verb === 'here' && x.out?.me && reading(x.out.me) && xz(x.out.me.pos) && Number.isFinite(x.out.me.heading)) }));
    const evidence = rows.flatMap((r) => r.steps.map(ctx.stepRef));
    const seen = rows.filter((r) => r.steps.length);
    if (seen.length < 3) return { verdict: 'unknown', evidence, uncertainty: `reading here samples for ${seen.length} of 3 Souls`, detail: rows.map((r) => ({ seat: r.seat, samples: r.steps.length, all: ctx.steps(r.seat).filter((x) => x.verb === 'here').map((x) => x.out?.me?.activity ?? null) })) };
    const at = seen.map((r) => [median(r.steps.map((x) => xz(x.out.me.pos)[0])), median(r.steps.map((x) => xz(x.out.me.pos)[1]))]);
    const centre = [at.reduce((n, p) => n + p[0], 0) / at.length, at.reduce((n, p) => n + p[1], 0) / at.length];
    const detail = seen.map((r) => {
      const e = r.steps.map((x) => { const p = xz(x.out.me.pos), d = Math.hypot(centre[0] - p[0], centre[1] - p[1]), round = d > 0.15 ? Math.asin(Math.min(1, 0.1 * Math.SQRT2 / d)) * 180 / Math.PI : 180;
        const err = off(x.out.me.heading, compass(centre[0] - p[0], centre[1] - p[1])); return { errorDeg: Math.round(err * 10) / 10, allowedDeg: Math.round((5.5 + round) * 10) / 10, ok: err <= 5.5 + round }; });
      return { seat: r.seat, samples: e.length, rows: e, maxErrorDeg: Math.max(...e.map((x) => x.errorDeg)) };
    });
    return { verdict: detail.every((d) => d.rows.every((x) => x.ok)) ? 'pass' : 'fail', evidence, detail: { centre, seats: detail } };
  },
};
