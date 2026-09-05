/**
 * Produit les secrets propres à CETTE installation, et les affiche. Rien d'autre.
 *
 *   node scripts/generate-secrets.mjs
 *
 * ⚠️ N'ÉCRIT DANS AUCUN FICHIER, ET C'EST LE POINT. Un script qui remplirait
 * `.env.local` tout seul finirait par remplir aussi un fichier suivi par git, un
 * jour où quelqu'un l'aurait lancé depuis le mauvais dossier. Les valeurs
 * s'affichent, on les copie là où elles doivent aller, et le terminal se ferme.
 *
 * ⚠️ CE QU'IL NE PEUT PAS FAIRE. Deux secrets sur quatre ne se fabriquent pas
 * ici : les clés Supabase et la clé Resend sont ÉMISES par ces services, et se
 * régénèrent depuis leurs tableaux de bord respectifs. Les inventer donnerait
 * des valeurs bien formées et parfaitement inutiles. La procédure complète, avec
 * l'ordre des opérations, est dans `docs/go-live.md`.
 *
 * ⚠️ LA LONGUEUR N'EST PAS UN ORNEMENT. `src/config/env.ts` exige 32 caractères
 * au minimum pour `CRON_SECRET` et `BACKUP_ENCRYPTION_KEY` ; on en produit 64 en
 * hexadécimal, soit 32 octets d'entropie réelle. Un secret « assez long » tiré à
 * la main ne l'est jamais.
 */

import { randomBytes } from "node:crypto";

/** 32 octets, rendus en hexadécimal : 64 caractères, tous prévisibles à copier. */
function secret() {
  return randomBytes(32).toString("hex");
}

const valeurs = [
  [
    "CRON_SECRET",
    secret(),
    "Authentifie les appels du planificateur vers /api/cron/*.",
    "Change : le planificateur doit être mis à jour EN MÊME TEMPS, sans quoi les\n" +
      "  échéances cessent d'être générées — en silence, jusqu'à la première manquée.",
  ],
  [
    "BACKUP_ENCRYPTION_KEY",
    secret(),
    "Chiffre les archives de sauvegarde.",
    "⚠️ NE CHANGE JAMAIS SANS PROCÉDURE. Les archives déjà produites restent\n" +
      "  chiffrées avec l'ANCIENNE clé : la remplacer sans conserver la précédente\n" +
      "  rend illisible tout l'historique. Voir docs/backup-strategy.md.",
  ],
];

const largeur = 78;

console.log("=".repeat(largeur));
console.log("SECRETS POUR CETTE INSTALLATION — à copier, jamais à commiter");
console.log("=".repeat(largeur));

for (const [nom, valeur, role, avertissement] of valeurs) {
  console.log(`\n${nom}`);
  console.log(`  ${role}`);
  console.log(`  ${avertissement}`);
  console.log(`\n  ${valeur}\n`);
  console.log("-".repeat(largeur));
}

console.log(
  [
    "",
    "CE QUI NE SE FABRIQUE PAS ICI :",
    "",
    "  SUPABASE_SERVICE_ROLE_KEY  — tableau de bord Supabase → Project Settings →",
    "  NEXT_PUBLIC_SUPABASE_ANON_KEY  API Keys. « Rotate » invalide l'ancienne",
    "                               IMMÉDIATEMENT : préparer le remplacement avant.",
    "",
    "  RESEND_API_KEY             — tableau de bord Resend → API Keys. Créer la",
    "                               nouvelle, déployer, PUIS révoquer l'ancienne.",
    "",
    "Où chaque secret doit vivre, et qui peut le lire : docs/go-live.md,",
    "section « Où vivent les secrets ».",
    "",
  ].join("\n"),
);
