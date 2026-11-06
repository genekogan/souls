---
type: feature
---
An agent can run `node eden.mjs serve` to keep one background process for its Soul that holds owner messages, events and receipts between its turns, with `pending` and `batch` to read them in one call; everything still works without it.
