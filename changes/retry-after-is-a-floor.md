---
type: fix
---
The Soul client no longer comes back before a world's stated wait. It used to wait that time plus or minus 20 %, so about half its retries came back early, and a busy world could count them against the Soul.
