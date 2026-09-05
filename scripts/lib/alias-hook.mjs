/**
 * Résout l'alias `@/…` pour les scripts d'exploitation.
 *
 *   node --import ./scripts/lib/alias-hook.mjs scripts/mon-script.mjs
 *
 * ⚠️ EXISTE POUR NE PAS DUPLIQUER UNE RÈGLE MÉTIER. Les scripts d'exploitation
 * du projet — sauvegarde, restauration — n'importent que des paquets et des
 * modules natifs, et c'est une bonne règle : ils doivent tourner même si
 * l'application ne compile pas. Le rattrapage d'archives, lui, a besoin du
 * CALCUL D'ÉCHÉANCE, qui vit dans `src/services/scheduling`. Le réécrire dans un
 * script en ferait une seconde source de vérité pour la seule chose du projet
 * dont une erreur produit une pénalité réelle (CLAUDE.md §3.4).
 *
 * Node sait charger le TypeScript depuis la version 22, mais ne connaît pas les
 * chemins de `tsconfig.json` : il ne manque donc que la traduction de l'alias.
 *
 * ⚠️ NE PAS EMPLOYER DEPUIS L'APPLICATION. Next résout `@/` lui-même, à la
 * compilation. Ce crochet ne sert qu'aux scripts lancés à la main.
 */

import { register } from "node:module";
import { pathToFileURL } from "node:url";

const RACINE = pathToFileURL(new URL("../../src/", import.meta.url).pathname).href;

register(
  // Le crochet est fourni en ligne : un fichier de plus pour vingt lignes
  // n'apporterait qu'un fichier de plus.
  "data:text/javascript," +
    encodeURIComponent(`
      const RACINE = ${JSON.stringify(new URL("../../src/", import.meta.url).href)};

      const STUB_SERVER_ONLY = ${JSON.stringify(new URL("../../tests/stubs/server-only.ts", import.meta.url).href)};

      export async function resolve(specifier, context, nextResolve) {
        /*
         * ⚠️ \`server-only\` lève hors composant serveur. Les services que ces
         * scripts appellent le déclarent à juste titre, et un script d'exploitation
         * EST du serveur — il n'y a simplement pas de rendu React pour le dire.
         * Même remplaçant que les deux lanceurs de tests, même raison : la garantie
         * de production reste le build Next, qui échoue si un module \`server-only\`
         * atteint un bundle client.
         */
        if (specifier === "server-only") return nextResolve(STUB_SERVER_ONLY, context);

        if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

        /*
         * ⚠️ L'EXTENSION EST DEVINÉE, faute d'être écrite. Les imports du projet
         * s'écrivent sans extension — c'est ce que TypeScript attend — alors que
         * Node l'exige. On essaie donc les formes possibles, dans l'ordre où
         * elles apparaissent dans le projet, et l'on rend la première qui existe.
         */
        const base = new URL(specifier.slice(2), RACINE).href;
        const candidats = [base + ".ts", base + ".tsx", base + "/index.ts", base];

        for (const candidat of candidats) {
          try {
            return await nextResolve(candidat, context);
          } catch {
            // Candidat suivant. L'échec de tous remonte ci-dessous.
          }
        }
        return nextResolve(base, context);
      }
    `),
  RACINE,
);
