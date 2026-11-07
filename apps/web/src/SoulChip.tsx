/** #892 phone navigation: the bottom chip. When a touch followed a Soul (one tap on its body or name plate, or a swipe), the
 * Soul's card collapses to this chip: its name, its status line and a "Card" button that opens the full card. In Broadcast
 * on a touch screen it reads "Now showing <name>" with a Follow button. A short note (a swipe with no other Soul here)
 * replaces the status line for a moment. It only reads the viewer's state; every camera move is the viewer's own. */
export type SoulChipProps =
  | { kind: 'follow'; name: string; status: string; note?: string; openCard(): void }
  | { kind: 'broadcast'; name: string; follow(): void };

export function SoulChip(props: SoulChipProps) {
  return <div className="soul-chip" data-chip={props.kind} role="group" aria-label={props.kind === 'follow' ? `Following ${props.name}` : `Now showing ${props.name}`}>
    <div className="soul-chip-text">
      {props.kind === 'follow'
        ? <><b className="soul-chip-name">{props.name}</b><span className="soul-chip-status" role={props.note ? 'status' : undefined}>{props.note || props.status || 'Following'}</span></>
        : <><span className="soul-chip-status">Now showing</span><b className="soul-chip-name">{props.name}</b></>}
    </div>
    {props.kind === 'follow'
      ? <button type="button" className="soul-chip-action" onClick={props.openCard}>Card</button>
      : <button type="button" className="soul-chip-action primary" onClick={props.follow}>Follow</button>}
  </div>;
}
