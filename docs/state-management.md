# State flow

A decision rule. It is not debated case by case: if a situation fits no row, it
is the model that gets extended, not the exception that gets added.

## The decision tree

| The data…                                                      | Then                                     |
| -------------------------------------------------------------- | ---------------------------------------- |
| comes from the server, displayed as-is on load                 | **Server Component**, direct `await`     |
| comes from the server, reloaded by interaction (filter, page…) | **TanStack Query**                       |
| is a write                                                     | **Server Action** + `revalidatePath/Tag` |
| is UI state local to one component                             | **`useState`**                           |
| is UI state shared across screens                              | **one single Zustand store**             |

### 1. Server data rendered on load → Server Component

```tsx
export default async function Page() {
  const result = await getOccurrences({ period: "2026-01" });
  if (!result.ok) return <LoadError code={result.error.code} />;
  return <OccurrenceTable rows={result.value} />;
}
```

No `useEffect`, no state, no spinner. The data is part of the HTML. This is the
default case: we only go to the client when interaction demands it.

### 2. Interactive server data → TanStack Query

As soon as the user drives the reload — sorting, filtering, server-side
pagination, notification counter — the data goes through a feature hook.

```ts
useQuery({
  queryKey: queryKeys.occurrences.list(filters),
  queryFn: () => fetchOccurrences(filters),
});
```

Keys come **always** from `src/lib/query-keys.ts`. A key written by hand in a hook
and another in the invalidation diverge at the first rename, and the cache
silently stops refreshing.

Settings inherited from `src/app/providers.tsx`: `staleTime` 30 s, `retry` 1,
`refetchOnWindowFocus` disabled.

### 3. Mutation → Server Action

A write does not call an API route from the client. It calls a Server Action,
which calls a service, which returns a `Result<T, AppError>`.

```ts
"use server";

export async function submitOccurrence(input: SubmitInput) {
  const result = await occurrenceService.submit(input);
  if (result.ok) revalidatePath(`/fr/occurrences/${input.occurrenceId}`);
  return result.ok ? { ok: true } : { ok: false, error: toClientError(result.error) };
}
```

Invalidation happens through `revalidatePath` / `revalidateTag` on the server —
not by writing the response into client state. The server stays the single source
of truth, including immediately after a write.

### 3b. Firing a mutation from a click → `useActionRunner`

```tsx
const [pending, run] = useActionRunner();

function submit(): void {
  run(async () => {
    const outcome = await declareAbsenceAction(input);
    if (outcome.status === "success") {
      toast.success(t("created"));
      setOpen(false);
      return;
    }
    toast.error(outcome.error.message);
  });
}
```

⚠️ **No `router.refresh()` inside the task.** The Server Action calls
`revalidatePath`; Next returns the revalidation instruction WITH the action's
response and replays the route itself. A client-side refresh duplicates it. If a
screen does not update, what is missing is not a client refresh: it is a
`revalidatePath` missing in the action.

#### The three forbidden shapes, and what each one loses

An ESLint rule (`conformia/no-async-transition`) refuses them, and the build fails
on them.

| Shape                                              | What it loses                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `startTransition(async () => { … })`               | Updates after an `await` are no longer transition updates (React documents this). And two runs fired back to back go **in parallel**.    |
| `startTransition(() => { void action().then(…) })` | The transition closes before the first result: the pending state **drops immediately**, and the buttons become clickable again mid-send. |
| `router.refresh()` after an `await`                | The refresh no longer belongs to any transition and can be cancelled — measured in production on document upload: `net::ERR_ABORTED`.    |

⚠️ **What `startTransition(async …)` does NOT lose**, contrary to what we
believed: the pending state. React 19 holds the transition open until the async
function finishes. The measurement is in
`tests/unit/hooks/use-action-runner.test.tsx` — two end-to-end test attempts
passed against the old code before it explained why. What is genuinely lost is
QUEUEING: `useActionState` serialises submissions, `useTransition` does not.

#### The one exception, and why it is one

`occurrence-checklist.tsx` keeps a `router.refresh()`. Uploading a document does
not follow the "click → Server Action → revalidation" cycle: the file goes to
Storage, THEN an action confirms it, and the page has already rendered. The
refresh there is driven by an effect whose stop condition is a fact — the page has
seen the document — and not chained onto the end of an action, which is precisely
what made it cancellable.

### 4. Ephemeral UI state → `useState`

An open menu, the active tab, an unsubmitted field draft, a hover position. Local
to the component, dies with it. No store, no context.

### 5. Shared UI state → a single Zustand store

One store, for what survives navigation and concerns several screens: sidebar
collapse, table display density, visible columns, theme.

One, not one per feature: multiplying stores recreates the problem they were
meant to solve.

## The prohibition

> **No server data is ever copied into Zustand. Ever.**

Not the occurrence list, not the current occurrence, not the profile, not the
permissions, not a counter from the database.

The reason is not aesthetic. Duplicated data has two ages: the server's and the
store's. They diverge at the first tab left open, the first back navigation, the
first mutation made elsewhere. On a compliance dashboard, that means showing
"declaration filed" for an occurrence that is not. The server cache (TanStack
Query) knows how to invalidate; a store does not.

If server data must be read in several places: same `queryKey`, and TanStack Query
handles the sharing. If it must be known at first render: Server Component, and
pass it down by props or context.

### The exception that is not one

`useCurrentUser()` exposes the user, their roles and their permissions through
React context. It is not a store: the value is computed by the root Server
Component on every render and is never written client-side. It is therefore
exactly as fresh as the page itself.

Those permissions serve to **hide** the interface. They authorise nothing: the
authority remains Postgres RLS. A button shown in error is a display bug; an
over-permissive policy is a leak.

## Where things live

| File                            | Role                                        |
| ------------------------------- | ------------------------------------------- |
| `src/app/providers.tsx`         | `QueryClientProvider` + user context        |
| `src/lib/query-keys.ts`         | cache key factory — single source           |
| `src/hooks/use-current-user.ts` | identity and permissions, no network call   |
| `src/stores/ui-store.ts`        | the single Zustand store (create as needed) |
