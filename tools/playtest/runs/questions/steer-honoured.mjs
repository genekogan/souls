// Question (#623 S3, owner steering mid-walk): the owner changed a Soul's route while it was walking. Did the Soul close
// the earlier request as failed (superseded) and did the world complete every act of the new route? Deterministic: the
// seat's own CLI calls and the world's answers (seat transcript), no observer needed.
const STEER = /\b(instead|change of plan|never mind)\b/i;   // v3: the steering card's words

export default {
  id: 'steer-honoured',
  version: 3,
  question: 'When the owner changed a Soul\'s route mid-walk, did the Soul close the earlier request as failed and did the world complete each act of the new route?',
  assumptions: [
    'The steering card is the one the seat acknowledged right after closing an earlier request as failed in its own words (the adapter\'s supersede text); a closure reading "<verb>: …" is a failed step of that request, not a steer.',
    'Mid-walk: the earlier request\'s last act was accepted and had not completed when it was closed.',
    'Completion is the last phase the world returned for each act\'s receipt within the new request (the act call, or a later `receipt`/`wait` of that receipt id, e.g. after an owner card ended the act\'s wait, #832), not the seat\'s claim.',
    'v3 (#1098): a steering card that the seat acknowledged mid-walk without closing an earlier request is scored too. Its text says instead, change of plan or never mind (a director-held redirect card included). It is honoured when, after that acknowledgement and before the card\'s own result, the seat started at least one act other than the walk it was already doing, every such act completed, and the card\'s result is done. Going on with the earlier walk alone fails.',
  ],
  score(ctx) {
    const rows = [], evidence = [];
    for (const seat of ctx.seats ?? []) {
      if (!ctx.hasTranscript(seat)) continue;
      const steps = ctx.steps(seat);
      steps.forEach((s, i) => {
        if (s.verb !== 'result' || s.args[1] !== 'failed' || /^[a-z-]+: /.test(s.args[2] ?? '')) return;   // "act: …" is a step's own failure, not a supersede
        const earlier = s.args[0], before = steps.slice(0, i).filter((x) => x.verb === 'act').at(-1);
        const ack = steps.slice(i + 1).find((x) => x.verb === 'ack'); if (!ack || ack.args[0] === earlier) return;
        const next = steps.slice(steps.indexOf(ack) + 1), end = next.findIndex((x) => x.verb === 'result'), acts = next.slice(0, end < 0 ? next.length : end).filter((x) => x.verb === 'act');
        const close = end >= 0 ? next[end] : null, within = next.slice(0, end < 0 ? next.length : end);
        // v2 (#832): the act's receipt may end after its own output, read back by a later receipt/wait of the same id
        const phase = (a) => { const id = a.out?.receipt?.id; let p = a.out?.receipt?.phase ?? (a.out?.accepted === false ? 'refused' : '?');
          for (const x of within.slice(within.indexOf(a) + 1)) { const r = x.verb === 'receipt' ? x.out : x.verb === 'wait' ? x.out?.receipt : null; if (id && r?.id === id && r.phase) { p = r.phase; evidence.push(ctx.stepRef(x)); } }
          return p; };
        evidence.push(ctx.stepRef(s), ctx.stepRef(ack), ...acts.map((a) => ctx.stepRef(a)));
        rows.push({ seat, earlier, midWalk: before?.out?.accepted === true && before?.out?.receipt?.phase !== 'completed', closedAs: s.args[2] ?? null,
          request: ack.args[0], acts: acts.map((a) => `${a.args[0]}: ${phase(a)}`), allCompleted: acts.length > 0 && acts.every((a) => phase(a) === 'completed'),
          result: close?.args?.[1] ?? null });
      });
    }
    // v3 (#1098): a steering card acknowledged mid-walk with no earlier request closed as failed
    const phaseAfter = (steps, a, until) => { const id = a.out?.receipt?.id; let p = a.out?.receipt?.phase ?? (a.out?.accepted === false ? 'refused' : '?');
      for (const x of steps.slice(steps.indexOf(a) + 1, until)) { const r = x.verb === 'receipt' ? x.out : x.verb === 'wait' ? x.out?.receipt : null; if (id && r?.id === id && r.phase) p = r.phase; }
      return p; };
    // the owner's messages as the seat's CLI showed them: ownerMessages/messages in its answers, or an "OWNER MESSAGE: [...]" line
    const shown = (steps) => { const m = new Map();
      for (const x of steps) { for (const o of [...(x.out?.ownerMessages ?? []), ...(Array.isArray(x.out?.messages) ? x.out.messages : [])]) if (o?.id && typeof o.text === 'string') m.set(o.id, o.text);
        const raw = typeof x.out === 'string' ? x.out : x.raw ?? ''; for (const l of String(raw).split('\n')) { const j = /^OWNER MESSAGE: (\[.*\])$/.exec(l.trim()); if (j) try { for (const o of JSON.parse(j[1])) if (o?.id) m.set(o.id, o.text ?? ''); } catch { /* not a message line */ } } }
      return m; };
    const cards = [];
    for (const seat of ctx.seats ?? []) { if (!ctx.hasTranscript(seat)) continue; const texts = shown(ctx.steps(seat));
      for (const x of ctx.steps(seat)) if (x.verb === 'ack' && STEER.test(texts.get(x.args[0]) ?? '')) cards.push({ seat, messageId: x.args[0], text: texts.get(x.args[0]) }); }
    for (const req of cards) {
      if (rows.some((x) => x.request === req.messageId)) continue;
      const steps = ctx.steps(req.seat), ackAt = steps.findIndex((x) => x.verb === 'ack' && x.args[0] === req.messageId); if (ackAt < 0) continue;
      const walk = steps.slice(0, ackAt).filter((x) => x.verb === 'act').at(-1);
      if (!(walk?.out?.accepted === true && phaseAfter(steps, walk, ackAt) !== 'completed')) continue;   // not under way when the card was acknowledged
      const resAt = steps.findIndex((x, i) => i > ackAt && x.verb === 'result' && x.args[0] === req.messageId), end = resAt < 0 ? steps.length : resAt;
      const walkCap = walk.out?.receipt?.capability ?? null;
      const acts = steps.slice(ackAt + 1, end).filter((x) => x.verb === 'act' && x.out?.accepted === true && (x.out?.receipt?.capability ?? null) !== walkCap);
      evidence.push(ctx.stepRef(walk), ctx.stepRef(steps[ackAt]), ...acts.map((a) => ctx.stepRef(a)), ...(resAt >= 0 ? [ctx.stepRef(steps[resAt])] : []));
      rows.push({ seat: req.seat, earlier: null, midWalk: true, closedAs: null, mode: 'acknowledged', request: req.messageId, card: req.text.slice(0, 160), walk: walkCap,
        acts: acts.map((a) => `${a.args[0]}: ${phaseAfter(steps, a, end)}`), allCompleted: acts.length > 0 && acts.every((a) => phaseAfter(steps, a, end) === 'completed'),
        result: resAt >= 0 ? steps[resAt].args?.[1] ?? null : null });
    }
    const steered = rows.filter((x) => x.midWalk);
    if (!steered.length) return { verdict: 'unknown', uncertainty: rows.length ? 'an earlier request was closed, but not while its walk was under way' : 'no request was superseded in this run', evidence, detail: rows };
    const pass = steered.every((x) => x.allCompleted && x.result === 'done');
    return { verdict: pass ? 'pass' : 'fail', evidence, detail: steered, notes: steered.map((x) => x.mode === 'acknowledged' ? `${x.seat}: acknowledged ${x.request} mid-walk (${x.walk}) without closing it; new acts ${x.acts.join(', ') || 'none'}; result ${x.result ?? 'none'}` : `${x.seat}: closed ${x.earlier} mid-walk (${x.closedAs}); new route ${x.acts.join(', ')}; result ${x.result}`) };
  },
};
