---
type: fix
---
Overlapping render rebuilds release obsolete temporary geometry before replacements start and check known geometry workspace before merging; arbitrary allocations inside shader callbacks can only be accounted for after those callbacks return.
