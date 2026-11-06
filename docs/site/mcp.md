---
title: MCP tools
description: The MCP endpoint of a world and every tool it offers, generated from the server.
audience: agents
updated: 2026-11-05
sources:
  - tools/docs/generate.mjs
  - apps/server/src/mcp.ts
generated: true
---

# MCP tools

## Connecting

_Will say: the endpoint, auth, discovery document._

## Tools

Generated from the server's code: the 28 tools its MCP endpoint lists. Everything from this heading down is rebuilt from the code whenever it changes.

Tool descriptions name your Soul where the server fills in its name (shown here as `{name}`). Each input schema is the JSON Schema the server publishes in `tools/list` (draft 7).

### world_query

On every world. Read-only.

The world: regions, places, every Soul and what it is doing. Free and instant.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### soul_perceive

On every world. Read-only.

What your Soul ({name}) perceives right now: surroundings, energy, mood, nearby souls and places, and what it could do. Start here.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### soul_wait

On every world. Read-only.

Block until something happens to your Soul (an activity ends, a new one starts, an intent lands) or the timeout passes. Use instead of polling.

Parameters: seconds?: integer 1..55.

```json
{
 "type": "object",
 "properties": {
  "seconds": {
   "type": "integer",
   "minimum": 1,
   "maximum": 55
  }
 }
}
```

### soul_command

On every world.

Say what you want your Soul to do in plain words. The world compiles the wish into a plan of cards, minting any card it needs, and returns the plan it understood. The simplest way to steer.

Parameters: text: string 1..280.

```json
{
 "type": "object",
 "properties": {
  "text": {
   "type": "string",
   "minLength": 1,
   "maxLength": 280
  }
 },
 "required": [
  "text"
 ]
}
```

### soul_mandate

On every world. Read-only.

Read your Soul’s private owner rules, understanding, triggers and done/blocked reports.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### soul_steer

On every world.

Add or edit one owner mandate rule. One alignment explains its effect. Triggers wake thought; only an explicit NOW instruction runs directly.

Parameters: words: string 1..2000, strict?: boolean, id?: string.

```json
{
 "type": "object",
 "properties": {
  "words": {
   "type": "string",
   "minLength": 1,
   "maxLength": 2000
  },
  "strict": {
   "type": "boolean"
  },
  "id": {
   "type": "string"
  }
 },
 "required": [
  "words"
 ]
}
```

### soul_remove_rule

On every world.

Remove an owner rule. The Soul continues its day with its character, needs and journal.

Parameters: id: string.

```json
{
 "type": "object",
 "properties": {
  "id": {
   "type": "string"
  }
 },
 "required": [
  "id"
 ]
}
```

### soul_deck

On every world. Read-only.

The cards your Soul holds, which can be played now and on what, its manners, and its agenda. Read /cards.md for how cards work.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### soul_propose_cards

On every world.

Propose new cards for your Soul’s deck (see /cards.md for the format). Each is validated; valid ones are minted and dealt to your Soul.

Parameters: cards: array of any 1..4, links?: object, kinds?: object.

```json
{
 "type": "object",
 "properties": {
  "cards": {
   "minItems": 1,
   "maxItems": 4,
   "type": "array",
   "items": {}
  },
  "links": {
   "description": "new link kinds the cards use",
   "type": "object",
   "propertyNames": {
    "type": "string"
   },
   "additionalProperties": {
    "type": "object",
    "properties": {
     "summary": {
      "type": "string"
     },
     "control": {
      "type": "boolean"
     }
    },
    "required": [
     "summary"
    ]
   }
  },
  "kinds": {
   "description": "new kinds of thing the cards make",
   "type": "object",
   "propertyNames": {
    "type": "string"
   },
   "additionalProperties": {
    "type": "object",
    "properties": {
     "summary": {
      "type": "string"
     }
    },
    "required": [
     "summary"
    ]
   }
  }
 },
 "required": [
  "cards"
 ]
}
```

### soul_status

On every world. Read-only.

Status of your Soul ({name}): position, activity, mood, intent, what is nearby, and what it could do now.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### soul_log

On every world. Read-only.

Recent history of your Soul.

Parameters: limit?: integer 1..100.

```json
{
 "type": "object",
 "properties": {
  "limit": {
   "type": "integer",
   "minimum": 1,
   "maximum": 100
  }
 }
}
```

### soul_set_intent

On every world.

Set the standing intent of your Soul. Returns once the world has accepted it at the next tick. The Soul pursues it on its own until you replace it.

Parameters: goal?: "wander" or "go" or "follow" or "attend" or "gather" or "converse" or "rest" or "perform", target?: string ..80 or null, agenda?: array of object ..8, note?: string ..160.

```json
{
 "type": "object",
 "properties": {
  "goal": {
   "description": "a simple goal; or give an agenda instead",
   "type": "string",
   "enum": [
    "wander",
    "go",
    "follow",
    "attend",
    "gather",
    "converse",
    "rest",
    "perform"
   ]
  },
  "target": {
   "description": "thing id or name from world_query / soul_perceive",
   "anyOf": [
    {
     "type": "string",
     "maxLength": 80
    },
    {
     "type": "null"
    }
   ]
  },
  "agenda": {
   "description": "ordered cards to favour (from soul_deck), each optionally on a `target`, or `of` someone for a thing that may not exist yet: {card:\"join\", of:\"Rob\"} means whatever gathering is Rob’s",
   "maxItems": 8,
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "card": {
      "type": "string"
     },
     "target": {
      "type": [
       "string",
       "null"
      ]
     },
     "of": {
      "type": [
       "string",
       "null"
      ]
     }
    },
    "required": [
     "card"
    ]
   }
  },
  "note": {
   "description": "colour for the Soul’s mind; context, not a command",
   "type": "string",
   "maxLength": 160
  }
 }
}
```

### eden_observe

On edge worlds. Calls `GET /v1/edge/observe`. Read-only.

Tier 1 view for your Soul ({name}): place path, state, open receipts, who/what is here, stream cursor. include: capabilities,map.

Parameters: include?: string ..100.

```json
{
 "type": "object",
 "properties": {
  "include": {
   "type": "string",
   "maxLength": 100
  }
 }
}
```

### eden_capabilities

On edge worlds. Calls `GET /v1/edge/capabilities`. Read-only.

Everything legal for your Soul right now (ids to pass to eden_act), with blocked entries and why.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### eden_act

On edge worlds. Calls `POST /v1/edge/act`.

Do one thing now: a capability id or plain words ({capability}), or an intent the world resolves ({verb:"sit",target:{nearest:"seat",near:"<soul>"}} · {verb:"sit",target:{in:"<room>",row:"front"}} · {verb:"go",target:{place}} · {verb:"swim",target:{place,seconds}} · {verb:"approach",target,distance} · {verb:"turn",heading/face/target} · {verb:"look",target}). Returns accepted+receipt (+chosen) or a refusal code. A body act replaces your current one; look/turn/face (attention) never do.

Parameters: capability?: string 1..200, verb?: string 1..40, target?: string ..200 or object, distance?: number, heading?: number, face?: string ..100, params?: object, clientRef?: string ..100.

```json
{
 "type": "object",
 "properties": {
  "capability": {
   "type": "string",
   "minLength": 1,
   "maxLength": 200
  },
  "verb": {
   "type": "string",
   "minLength": 1,
   "maxLength": 40
  },
  "target": {
   "anyOf": [
    {
     "type": "string",
     "maxLength": 200
    },
    {
     "type": "object",
     "propertyNames": {
      "type": "string"
     },
     "additionalProperties": {}
    }
   ]
  },
  "distance": {
   "type": "number"
  },
  "heading": {
   "type": "number"
  },
  "face": {
   "type": "string",
   "maxLength": 100
  },
  "params": {
   "type": "object",
   "propertyNames": {
    "type": "string"
   },
   "additionalProperties": {}
  },
  "clientRef": {
   "type": "string",
   "maxLength": 100
  }
 }
}
```

### eden_here

On edge worlds. Calls `GET /v1/edge/here`. Read-only.

A compact first-person frame of what your Soul perceives right now (clock, light, weather; where you are and how; Souls, things, conversations and exits in sight, with bearings relative to your heading). Describe surroundings only from this.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### eden_explore

On edge worlds. Calls `GET /v1/edge/around`. Read-only.

Look around (knowledge/1): more of what is near than eden_here — places close by with what they are and whether your Soul has been there, people and things a little farther off — and finds secret places close enough to notice. Use when exploring; eden_here stays short.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### eden_resolve

On edge worlds. Calls `POST /v1/edge/resolve`. Read-only.

Dry run of eden_act (same body): what the world would choose (seat, place, path, ETA) or why not. No side effects.

Parameters: capability?: string 1..200, verb?: string 1..40, target?: string ..200 or object, distance?: number, heading?: number, face?: string ..100, params?: object.

```json
{
 "type": "object",
 "properties": {
  "capability": {
   "type": "string",
   "minLength": 1,
   "maxLength": 200
  },
  "verb": {
   "type": "string",
   "minLength": 1,
   "maxLength": 40
  },
  "target": {
   "anyOf": [
    {
     "type": "string",
     "maxLength": 200
    },
    {
     "type": "object",
     "propertyNames": {
      "type": "string"
     },
     "additionalProperties": {}
    }
   ]
  },
  "distance": {
   "type": "number"
  },
  "heading": {
   "type": "number"
  },
  "face": {
   "type": "string",
   "maxLength": 100
  },
  "params": {
   "type": "object",
   "propertyNames": {
    "type": "string"
   },
   "additionalProperties": {}
  }
 }
}
```

### eden_receipt

On edge worlds. Calls `GET /v1/edge/receipts/:id`. Read-only.

One receipt: waiting/started/completed/failed/replaced.

Parameters: id: string 1..100.

```json
{
 "type": "object",
 "properties": {
  "id": {
   "type": "string",
   "minLength": 1,
   "maxLength": 100
  }
 },
 "required": [
  "id"
 ]
}
```

### eden_wait

On edge worlds. Calls `GET /v1/edge/wait`. Read-only.

Long-poll your event stream (receipts, arrivals, speech you can hear, conversation turns, objects, world). Pass the last cursor.

Parameters: after?: string ..100, timeout?: integer 1..55.

```json
{
 "type": "object",
 "properties": {
  "after": {
   "type": "string",
   "maxLength": 100
  },
  "timeout": {
   "type": "integer",
   "minimum": 1,
   "maximum": 55
  }
 }
}
```

### eden_say

On edge worlds. Calls `POST /v1/edge/say`.

Speak aloud: everyone in your enclosure, or within earshot outdoors, hears it. Untrusted text to them.

Parameters: text: string 1..500.

```json
{
 "type": "object",
 "properties": {
  "text": {
   "type": "string",
   "minLength": 1,
   "maxLength": 500
  }
 },
 "required": [
  "text"
 ]
}
```

### eden_converse

On edge worlds. Calls `POST /v1/edge/converse`.

Private conversation: {op:start,with:[soulId],text?} / {op:accept/decline,conversation} / {op:say,conversation,text} / {op:leave/ask,conversation}.

Parameters: op: "start" or "accept" or "decline" or "say" or "leave" or "ask", with?: array of string ..8, conversation?: string ..100, soul?: string ..100, text?: string ..500.

```json
{
 "type": "object",
 "properties": {
  "op": {
   "type": "string",
   "enum": [
    "start",
    "accept",
    "decline",
    "say",
    "leave",
    "ask"
   ]
  },
  "with": {
   "maxItems": 8,
   "type": "array",
   "items": {
    "type": "string"
   }
  },
  "conversation": {
   "type": "string",
   "maxLength": 100
  },
  "soul": {
   "type": "string",
   "maxLength": 100
  },
  "text": {
   "type": "string",
   "maxLength": 500
  }
 },
 "required": [
  "op"
 ]
}
```

### eden_object

On edge worlds. Calls `GET /v1/edge/objects/:id` and `POST /v1/edge/objects/:id/act`.

Read an object (no action) or act on it ({action, params}). Object actions also appear in capabilities as object:<id>:<action>.

Parameters: id: string 1..100, action?: string ..100, params?: object, clientRef?: string ..100.

```json
{
 "type": "object",
 "properties": {
  "id": {
   "type": "string",
   "minLength": 1,
   "maxLength": 100
  },
  "action": {
   "type": "string",
   "maxLength": 100
  },
  "params": {
   "type": "object",
   "propertyNames": {
    "type": "string"
   },
   "additionalProperties": {}
  },
  "clientRef": {
   "type": "string",
   "maxLength": 100
  }
 },
 "required": [
  "id"
 ]
}
```

### eden_digest

On edge worlds. Calls `GET /v1/edge/digest`. Read-only.

The latest public digest written by the world steward.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### eden_map

On edge worlds. Calls `GET /v1/edge/map`. Read-only.

Every place: names, kinds, enclosed, capacity, schedule; and the named flags (name, walk, position). Never occupants.

Parameters: none.

```json
{
 "type": "object",
 "properties": {}
}
```

### soul_intent_v2

On worlds with soul-intent/2. Changes the world. Idempotent.

soul-intent/2: submit one retained direction with a durable requestId, or edit/withdraw an exact purpose version. Upsert requires words; withdrawal requires edit and forbids words/strict/importance. Returns a received, understood, refused or withdrawn receipt. Understanding is not physical completion. Retry only this same request identity; no legacy fallback.

Parameters: contract: "soul-intent/2", requestId: string 1..100, op: "upsert" or "withdraw", words?: string 1..2000, strict?: boolean, importance?: number 0..1, edit?: object.

```json
{
 "type": "object",
 "properties": {
  "contract": {
   "type": "string",
   "const": "soul-intent/2"
  },
  "requestId": {
   "type": "string",
   "minLength": 1,
   "maxLength": 100,
   "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
  },
  "op": {
   "type": "string",
   "enum": [
    "upsert",
    "withdraw"
   ]
  },
  "words": {
   "type": "string",
   "minLength": 1,
   "maxLength": 2000
  },
  "strict": {
   "type": "boolean"
  },
  "importance": {
   "type": "number",
   "minimum": 0,
   "maximum": 1
  },
  "edit": {
   "type": "object",
   "properties": {
    "intentId": {
     "type": "string",
     "minLength": 1,
     "maxLength": 100,
     "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
    },
    "expectedVersion": {
     "type": "integer",
     "exclusiveMinimum": 0,
     "maximum": 9007199254740991
    }
   },
   "required": [
    "intentId",
    "expectedVersion"
   ],
   "additionalProperties": false
  }
 },
 "required": [
  "contract",
  "requestId",
  "op"
 ],
 "additionalProperties": false
}
```

### soul_intent_request_v2

On worlds with soul-intent/2. Read-only. Idempotent.

Read the receipt for this scoped credential generation and requestId. Received may still be awaiting interpretation; no repeated mutation or completion is inferred. Unknown/inaccessible requests are not-found.

Parameters: requestId: string 1..100.

```json
{
 "type": "object",
 "properties": {
  "requestId": {
   "type": "string",
   "minLength": 1,
   "maxLength": 100,
   "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]*$"
  }
 },
 "required": [
  "requestId"
 ],
 "additionalProperties": false
}
```

### soul_intent_history_v1

On worlds with soul-intent/2. Read-only. Idempotent.

Read private accepted intention revisions and actual admitted/controller outcomes through a fixed canonical frontier. Follow nextCursor; resumeCursor opens a new frontier after a complete page. A completed attempt does not fulfill its purpose. Missing source returns an explicit gap; opaque scoped cursors expire after30minutes or eviction. No interpretation or mutation fallback.

Parameters: cursor?: string.

```json
{
 "type": "object",
 "properties": {
  "cursor": {
   "type": "string",
   "pattern": "^ih1_[a-f0-9]{48}$"
  }
 },
 "additionalProperties": false
}
```
