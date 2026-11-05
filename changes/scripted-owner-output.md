---
type: internal
---
Scripted-owner playtest seats keep each CLI output whole for scoring (up to 1 MiB, then an explicit truncation marker), so long `around` and `map` answers are no longer cut mid-JSON.
