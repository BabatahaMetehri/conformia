/**
 * FICHIER GÉNÉRÉ — NE JAMAIS ÉDITER À LA MAIN.
 * Régénération : `npm run db:types`
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AMORCE : aucune migration n'existe encore. Ce contenu est un squelette valide
 * qui sera intégralement écrasé à la première exécution de `npm run db:types`.
 *
 * L'énumération `occurrence_status` ci-dessous est le contrat attendu de la
 * première migration (cf. CLAUDE.md §1). Si la migration ne crée pas ce type
 * avec ces valeurs, `src/types/domain.ts` cessera de compiler — c'est voulu.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      occurrence_status:
        | "TODO"
        | "IN_PROGRESS"
        | "PENDING_VALIDATION"
        | "VALIDATED"
        | "SUBMITTED"
        | "ARCHIVED"
        | "REJECTED"
        | "NOT_APPLICABLE";
    };
    CompositeTypes: Record<never, never>;
  };
}
