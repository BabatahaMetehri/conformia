/**
 * Fonction Edge — génération quotidienne des occurrences.
 *
 * Déclenchée par pg_cron à 01 h 00 UTC, soit 02 h 00 à Alger. ⚠️ L'Algérie est à
 * UTC+1 toute l'année, sans heure d'été : la conversion est fixe, et c'est la
 * migration 0013 qui porte la planification.
 *
 * ⚠️ CETTE FONCTION NE CALCULE RIEN. Elle appelle la route applicative, qui
 * détient le moteur. Réimplémenter la génération ici ferait une SECONDE
 * implémentation du calcul d'échéance — exactement ce que le projet refuse
 * partout ailleurs, et le jour où les deux divergeraient, les dates affichées
 * ne seraient plus celles qui sont générées.
 *
 * Elle n'existe donc que pour porter le déclenchement là où pg_net peut
 * l'atteindre, et pour transmettre le secret sans l'exposer dans une requête SQL.
 *
 * Déploiement : `supabase functions deploy generate-occurrences --no-verify-jwt`
 * Secrets attendus : APP_URL, CRON_SECRET.
 */

Deno.serve(async () => {
  const appUrl = Deno.env.get("APP_URL");
  const cronSecret = Deno.env.get("CRON_SECRET");

  if (appUrl === undefined || cronSecret === undefined) {
    // On échoue BRUYAMMENT plutôt que de ne rien faire : une génération
    // silencieusement absente ne se découvre qu'au premier retard.
    return new Response(JSON.stringify({ error: "APP_URL ou CRON_SECRET manquant" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await fetch(`${appUrl}/api/cron/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
    },
  });

  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});
