# Circulation de l'état

Règle de décision. Elle ne se discute pas au cas par cas : si une situation ne
rentre dans aucune ligne, c'est le modèle qu'on étend, pas l'exception qu'on
ajoute.

## L'arbre de décision

| La donnée…                                                    | Alors                                    |
| ------------------------------------------------------------- | ---------------------------------------- |
| vient du serveur, affichée telle quelle au chargement         | **Server Component**, `await` direct     |
| vient du serveur, rechargée par l'interaction (filtre, page…) | **TanStack Query**                       |
| est une écriture                                              | **Server Action** + `revalidatePath/Tag` |
| est un état d'interface local à un composant                  | **`useState`**                           |
| est un état d'interface partagé entre écrans                  | **un seul store Zustand**                |

### 1. Donnée serveur rendue au chargement → Server Component

```tsx
export default async function Page() {
  const result = await getOccurrences({ period: "2026-01" });
  if (!result.ok) return <LoadError code={result.error.code} />;
  return <OccurrenceTable rows={result.value} />;
}
```

Pas de `useEffect`, pas de state, pas de spinner. La donnée fait partie du HTML.
C'est le cas par défaut : on ne passe au client que si l'interaction l'exige.

### 2. Donnée serveur interactive → TanStack Query

Dès que l'utilisateur pilote le rechargement — tri, filtre, pagination serveur,
compteur de notifications — la donnée passe par un hook de feature.

```ts
useQuery({
  queryKey: queryKeys.occurrences.list(filters),
  queryFn: () => fetchOccurrences(filters),
});
```

Les clés viennent **toujours** de `src/lib/query-keys.ts`. Une clé écrite à la
main dans un hook et une autre dans l'invalidation divergent au premier
renommage, et le cache cesse silencieusement de se rafraîchir.

Réglages hérités de `src/app/providers.tsx` : `staleTime` 30 s, `retry` 1,
`refetchOnWindowFocus` désactivé.

### 3. Mutation → Server Action

Une écriture n'appelle pas une route d'API depuis le client. Elle appelle une
Server Action, qui appelle un service, qui rend un `Result<T, AppError>`.

```ts
"use server";

export async function submitOccurrence(input: SubmitInput) {
  const result = await occurrenceService.submit(input);
  if (result.ok) revalidatePath(`/fr/occurrences/${input.occurrenceId}`);
  return result.ok ? { ok: true } : { ok: false, error: toClientError(result.error) };
}
```

L'invalidation se fait par `revalidatePath` / `revalidateTag` côté serveur — pas
en écrivant la réponse dans un state client. Le serveur reste la seule source de
vérité, y compris juste après une écriture.

### 4. État d'interface éphémère → `useState`

Ouverture d'un menu, onglet actif, brouillon de champ non soumis, position d'un
survol. Local au composant, mort avec lui. Aucun store, aucun contexte.

### 5. État d'interface partagé → un unique store Zustand

Un seul store, pour ce qui survit à la navigation et concerne plusieurs écrans :
repli de la barre latérale, densité d'affichage des tableaux, colonnes visibles,
thème.

Un seul, pas un par feature : multiplier les stores recrée le problème qu'ils
étaient censés régler.

## L'interdiction

> **Aucune donnée serveur ne se copie dans Zustand. Jamais.**

Pas la liste des occurrences, pas l'occurrence courante, pas le profil, pas les
permissions, pas un compteur venu de la base.

La raison n'est pas esthétique. Une donnée dupliquée a deux âges : celui du
serveur et celui du store. Ils divergent au premier onglet resté ouvert, au
premier retour arrière, à la première mutation faite ailleurs. Sur un tableau de
bord de conformité, cela veut dire afficher « déclaration déposée » pour une
occurrence qui ne l'est pas. Le cache serveur (TanStack Query) sait invalider ;
un store ne le sait pas.

Si une donnée serveur doit être lue à plusieurs endroits : même `queryKey`,
TanStack Query s'occupe du partage. Si elle doit être connue au premier rendu :
Server Component, et descente par props ou contexte.

### L'exception qui n'en est pas une

`useCurrentUser()` expose l'utilisateur, ses rôles et ses permissions par
contexte React. Ce n'est pas un store : la valeur est calculée par le Server
Component racine à chaque rendu et n'est jamais écrite côté client. Elle est
donc aussi fraîche que la page elle-même.

Ces permissions servent à **masquer** l'interface. Elles n'autorisent rien :
l'autorité reste la RLS Postgres. Un bouton affiché à tort est un défaut
d'affichage ; une policy trop permissive est une fuite.

## Où vit quoi

| Fichier                         | Rôle                                         |
| ------------------------------- | -------------------------------------------- |
| `src/app/providers.tsx`         | `QueryClientProvider` + contexte utilisateur |
| `src/lib/query-keys.ts`         | fabrique des clés de cache — source unique   |
| `src/hooks/use-current-user.ts` | identité et droits, sans appel réseau        |
| `src/stores/ui-store.ts`        | l'unique store Zustand (à créer au besoin)   |
