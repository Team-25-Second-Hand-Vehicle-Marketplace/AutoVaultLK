# normalize-embed — a deliberate copy

**These five `.ts` files are a byte-for-byte copy of
`marketplace-service/src/shared/normalize-embed/`. Do not edit one without the
other.**

The rule is enforced, not just documented:
`ingestion-service/test/unit/shared/normalize-embed-parity.spec.ts` reads
marketplace-service's copy off disk and fails the build if the two diverge.

> No change-rule comment is inlined in the `.ts` files themselves — the parity
> test compares file contents byte for byte, so a header in one copy and not the
> other would itself be the drift it is meant to catch. This README is the
> right place for it.

## Why a copy rather than a shared package

`marketplace.vehicles.embedding` is a 384-float vector compared by cosine
distance. A vector means nothing on its own — it is interpretable only relative
to vectors produced by **the same model** from **the same-shaped text**. If
ingestion's `buildSearchText` diverged from search's (a dropped field, a
different order) or the two used different MiniLM builds, bulk-uploaded listings
would occupy a different region of vector space than manually created ones and
would rank badly **forever, with no error, no failing test, and no log line**.
That is what `Documentation/plan-b-reads-cross-schemas.md` §9A calls *silent
drift*, and what FR-22.1 / NFR-26.1 exist to prevent.

A top-level package consumed via `file:../shared-normalize-embed` was considered
and **rejected**: the service Dockerfiles run `npm ci` before copying `src`, so a
`file:` dependency outside the build context cannot resolve; adopting it would
force every image's build context to the repository root, change CI, and stop
working altogether once these directories become separate GitHub repositories
(SAD §8.1). The parity test buys the same protection at none of that cost.

## Change rule — read before editing

**Editing `buildSearchText()` or `EMBEDDING_MODEL_ID` invalidates every
embedding already stored in `marketplace.vehicles`.** Rows embedded under the
old definition are no longer comparable to rows embedded under the new one.

A change to either requires all of:

1. Apply the identical edit to **both** copies — the parity test fails otherwise.
2. Re-run `cd database && npm run seed:embeddings` in every environment, so no
   row is left on the old definition.
3. Re-run the parity and `search-text` specs in both services.
4. Add an entry to the silent-drift checklist in
   `Documentation/plan-b-reads-cross-schemas.md` §9A.

`marketplace-service/src/modules/listings/repositories/listing.repository.ts`
keeps a `SEARCHABLE_FIELDS` list serving the same purpose on the update path;
keep it in step with any field added here.

## When the repos split

Once `ingestion-service` and `marketplace-service` become separate
repositories, the sibling path disappears and the parity test skips itself
automatically. At that point this becomes a published-package problem: extract
to a real npm package and depend on a pinned version from both sides.
