# Rule-Based Parser — Pseudocode

> Companion to `intelligent-search.pdf` §3–4. Written to make the extractor
> order and each step's internal logic concrete enough to implement from.

---

## 0. Shared data structures

```
Token {
  text: string            // lowercased, punctuation-stripped
  start: int               // index into the token array
  end: int                 // start + phraseLength - 1 (multi-word)
  isStopword: bool          // masked, never deleted — see stopwords doc
  isConsumed: bool          // true once any extractor claims it
  isDigitAdjacent: bool     // set by Stage 2, read by Stage 4
  resolvedBy: string | null // 'PHRASE' | 'NUMERIC' | 'EXACT' | 'FUZZY' | null
}

ParseResult {
  filters: { [field]: value }        // e.g. { seats: 4, maxPrice: 20000000 }
  unresolved: Token[]                // survivors of every stage
  meta: { [field]: { method, confidence, raw } }  // provenance, for §5 scoring
}
```

Every stage receives the same mutable `Token[]` and the same `filters` object,
mutates both, and passes them to the next stage. Nothing is ever deleted from
the token array — only flagged.

---

## 1. Tokenize + mask stopwords

Runs once, before Stage 1.

```
function tokenize(rawQuery):
  words = rawQuery.toLowerCase().split(/\s+/).map(stripPunctuation)
  tokens = []
  for i, word in enumerate(words):
    tokens.push(Token {
      text: word, start: i, end: i,
      isStopword: STOPWORD_SET.has(word),
      isConsumed: false, isDigitAdjacent: false, resolvedBy: null
    })
  return tokens
```

`STOPWORD_SET` is the domain list from §3.1 — never an off-the-shelf English
list, because it must exclude `under`, `below`, `over`, `between`, `above`,
`not`.

---

## 2. Stage 1 — Multi-word phrases

**Must run first**, on the raw, fully-unconsumed token array. Every later
stage looks at individual tokens; this is the only stage that looks at
*windows* of tokens, so it is the only stage that can still see `"land
cruiser"` as one thing instead of two orphans.

```
PHRASE_TABLE = [
  // longest phrases first — see note below
  { pattern: ["four", "wheel", "drive"], field: "driveType", value: "4WD" },
  { pattern: ["land", "cruiser"],        field: "model",     value: "Land Cruiser", requiresMake: "Toyota" },
  { pattern: [NUM, "seats"],             field: "seats",     value: MATCH_GROUP(1) },   // NUM = any digit token
  { pattern: [NUM, "seater"],            field: "seats",     value: MATCH_GROUP(1) },
  { pattern: ["long", "term", "lease"],  field: "listingType", value: "LEASE" },
  // ... more, seeded from real query logs
]

function extractPhrases(tokens, filters):
  // longest windows first: a 3-word phrase must be tried before the 2-word
  // phrase that could be a false substring of it
  for windowSize in [3, 2]:
    for i from 0 to len(tokens) - windowSize:
      window = tokens[i : i + windowSize]
      if any(t.isConsumed for t in window): continue     // never re-claim

      entry = matchPhrase(window, PHRASE_TABLE)            // exact or NUM-slot match
      if entry is not None:
        filters[entry.field] = entry.value
        for t in window:
          t.isConsumed = true
          t.resolvedBy = 'PHRASE'
```

**Why longest-window-first, specifically:** without it, `"four wheel"` could
false-match a hypothetical 2-word entry before the parser ever tries the
correct 3-word `"four wheel drive"` phrase, because a shorter window is
checked at the same starting position. Trying 3 before 2 means the more
specific, more information-bearing match always wins when both are possible.

**Why numeric-slot phrases (`NUM, "seats"`) belong here, not in Stage 2:**
`"4 seats"` is semantically one filter (`seats = 4`), not two independent
facts. If Stage 2 numeric-pattern matching ran first and grabbed `"4"` as a
bare number, Stage 1 would arrive to find `"4"` already consumed and would
be unable to bind it to `seats` — it would just see the orphaned word
`"seats"`, which resolves to nothing. Phrases with a numeric slot must be
tried before free-floating numeric extraction, precisely because the phrase
is more specific than the number alone.

---

## 3. Stage 2 — Numeric patterns

Runs second, on whatever Stage 1 left unconsumed. This stage does two jobs at
once: it resolves numbers into filters, **and** it stamps `isDigitAdjacent`
on every neighbor of a number — the flag Stage 4 depends on to prevent
`"seattts"` → `SEAT`.

```
NUMERIC_PATTERNS = [
  { regex: /^(\d+)k$/i,          unit: 1000,       field: guess },  // "95k" -> 95000
  { regex: /^([\d.]+)m(n)?$/i,   unit: 1000000,    field: guess },  // "8.5m", "9mn" -> ×1e6
  { regex: /^(\d{4})$/,          rangeCheck: [1980, currentYear+1], field: "year" },
  { regex: /^(\d{1,2})$/,        field: "seats", onlyIf: nextTokenIs(["seat","seats","seater"]) },
  { regex: /^\d+(\.\d+)?$/,      field: guess },  // bare number, field inferred from comparator context
]

COMPARATOR_WORDS = { under: "max", below: "max", over: "min", above: "min" }

function extractNumeric(tokens, filters):
  for i, token in enumerate(tokens):
    if token.isConsumed or token.isStopword: continue
    if not containsDigit(token.text): continue

    match = matchFirst(NUMERIC_PATTERNS, token.text)
    if match is None: continue

    value = normalizeNumber(match)                 // "95k" -> 95000, "8.5m" -> 8500000

    // look one token back for a comparator ("under 20 million")
    comparator = null
    if i > 0 and tokens[i-1].text in COMPARATOR_WORDS:
      comparator = COMPARATOR_WORDS[tokens[i-1].text]
      tokens[i-1].isConsumed = true
      tokens[i-1].resolvedBy = 'NUMERIC'

    field = resolveField(match, comparator)         // e.g. "maxPrice" vs "price"
    filters[field] = value
    token.isConsumed = true
    token.resolvedBy = 'NUMERIC'

    // --- the type-gating write: this is the important side effect ---
    if i > 0:            tokens[i-1].isDigitAdjacent = true
    if i < len(tokens)-1: tokens[i+1].isDigitAdjacent = true
```

**Why the digit-adjacency flag is written here and only here:** Stage 2 is
the only stage that knows, at parse time, which tokens sat next to a number
in the original query. By the time Stage 4 runs, that positional context
would otherwise be lost — Stage 4 only sees a flat bag of leftover tokens.
Writing the flag now and reading it later is how "5 seattts" stays blocked
from matching SEAT: `seattts` sits adjacent to `5`, gets flagged here in
Stage 2, and Stage 4 refuses to fuzzy-match anything carrying that flag,
regardless of how good the trigram score looks.

---

## 4. Stage 3 — Exact dictionary hit

One dictionary per closed-vocabulary **column**, not one dictionary overall:

```
DICTIONARIES = {
  make:          HashMap<string, string>,   // "toyota" -> "Toyota"
  model:         HashMap<string, HashMap>,  // keyed by resolved make, see below
  fuel:          HashMap<string, string>,   // "petrol" -> "PETROL"
  transmission:  HashMap<string, string>,   // "auto"   -> "AUTOMATIC"
  bodyType:      HashMap<string, string>,   // "suv"    -> "SUV"
}
```

Resolution order **within** this stage is not arbitrary either: `make` must
resolve before `model`, because `model` lookups are scoped by the resolved
make. Running them in the wrong order forces a global model search across
every manufacturer, which is both slower and more error-prone (`"civic"`
exists only under Honda; searching it globally is pointless extra risk).

```
function extractExact(tokens, filters):
  // pass 1: make (and every non-model dictionary — order among these doesn't matter)
  for token in tokens:
    if token.isConsumed or token.isStopword: continue
    for field in ["make", "fuel", "transmission", "bodyType"]:
      hit = DICTIONARIES[field].get(token.text)
      if hit is not None:
        filters[field] = hit
        token.isConsumed = true
        token.resolvedBy = 'EXACT'
        break

  // pass 2: model, now that make (if present) is known
  resolvedMake = filters.get("make")
  modelDict = resolvedMake
    ? DICTIONARIES.model.get(resolvedMake)   // scoped
    : DICTIONARIES.model.getAll()            // unscoped fallback, higher false-positive risk

  for token in tokens:
    if token.isConsumed or token.isStopword: continue
    hit = modelDict.get(token.text)
    if hit is not None:
      filters.model = hit
      token.isConsumed = true
      token.resolvedBy = 'EXACT'
```

Two passes, not one — that's the mechanism that makes "correct make first,
then constrain model by it" actually happen in code rather than just being a
design intention.

---

## 5. Stage 4 — Fuzzy dictionary hit

Only for tokens Stage 3 left unresolved. Two gates, both mandatory, checked
in this order:

```
FUZZY_THRESHOLD_SHORT = 0.8   // token length < 5
FUZZY_THRESHOLD_LONG  = 0.6   // token length >= 5

function extractFuzzy(tokens, filters, db):
  resolvedMake = filters.get("make")

  for token in tokens:
    if token.isConsumed or token.isStopword: continue

    // GATE 1 — type gating. Non-negotiable, checked before any DB call.
    if token.isDigitAdjacent: continue

    threshold = token.text.length < 5 ? FUZZY_THRESHOLD_SHORT : FUZZY_THRESHOLD_LONG

    // makes: only if make is not already resolved
    if resolvedMake is None:
      candidate = db.query(`
        SELECT canonical_name, similarity(name, $1) AS score
        FROM makes WHERE similarity(name, $1) > $2
        ORDER BY score DESC LIMIT 1
      `, [token.text, threshold])
      if candidate:
        filters.make = candidate.canonical_name
        resolvedMake = candidate.canonical_name
        token.isConsumed = true
        token.resolvedBy = 'FUZZY'
        continue

    // models: scoped to resolved make if we have one
    if resolvedMake and not filters.get("model"):
      candidate = db.query(`
        SELECT canonical_name, similarity(name, $1) AS score
        FROM models WHERE make_id = (SELECT id FROM makes WHERE canonical_name = $2)
          AND similarity(name, $1) > $3
        ORDER BY score DESC LIMIT 1
      `, [token.text, resolvedMake, threshold])
      if candidate:
        filters.model = candidate.canonical_name
        token.isConsumed = true
        token.resolvedBy = 'FUZZY'
```

**GATE 1 is checked before any database call is issued** — not as an
afterthought filter on results. This is deliberate: it means a digit-adjacent
token never even reaches `pg_trgm`, so there is no code path where a good
trigram score can override the type gate. The gate and the query are not
independent steps that could be reordered by a future refactor; the gate is
structurally in front of the query.

---

## 6. Stage 5 — Leftovers

```
function collectUnresolved(tokens):
  unresolved = [t for t in tokens if not t.isConsumed and not t.isStopword]
  // semantic_text is built from ORIGINAL spans, stopwords included —
  // this is the mask-don't-delete rule from §3.1 in practice
  semanticText = reconstructOriginalText(tokens, excludeConsumedSpans=true)
  return { unresolvedTokens: unresolved, semanticText: semanticText }
```

Nothing here is a parser failure. `"comfortabble"`, `"sporting"` land here
because no dictionary of adjectives exists — that's correct, not a gap.

---

## 7. Driver — the full pipeline in order

```
function parseQuery(rawQuery, db):
  tokens = tokenize(rawQuery)                    // §1
  filters = {}

  extractPhrases(tokens, filters)                // Stage 1 — needs raw stream
  extractNumeric(tokens, filters)                // Stage 2 — writes isDigitAdjacent
  extractExact(tokens, filters)                  // Stage 3 — make before model
  extractFuzzy(tokens, filters, db)               // Stage 4 — gated by Stage 2's flags
  { unresolvedTokens, semanticText } = collectUnresolved(tokens)  // Stage 5

  confidence = scoreConfidence(tokens, filters, unresolvedTokens)  // §5, separate doc
  return ParseResult { filters, unresolved: unresolvedTokens, semanticText, confidence }
```

The dependency chain, stated plainly:

```
Stage 1 needs:  the raw token array (nothing consumed yet)
Stage 2 needs:  Stage 1 done (so "4 seats" isn't split into a stray "4")
Stage 3 needs:  Stage 2 done (so digit-adjacent tokens are already flagged,
                even though Stage 3 doesn't check the flag — Stage 4 does)
Stage 4 needs:  Stage 2's isDigitAdjacent flags + Stage 3's resolved make
Stage 5 needs:  everything above done — it just sweeps what's left
```

Reordering any adjacent pair reintroduces one of the two documented failure
modes: split phrases (Stage 1 moved later) or `"seattts"` → `SEAT` (Stage 2
moved later, or its flag skipped in Stage 4).
