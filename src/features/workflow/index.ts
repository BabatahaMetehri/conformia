/**
 * Surface publique de la feature workflow.
 *
 * Un import d'un chemin interne depuis une AUTRE feature est interdit (barrière
 * inter-features) ; l'app, elle, passe par ici.
 */

export { ValidationQueue } from "@/features/workflow/components/validation-queue";
export { DelegationsView } from "@/features/workflow/components/delegations-view";
export type {
  ActionOutcome,
  BulkOutcome,
  DelegationOutcome,
  ReviewOutcome,
  ValidationOutcome,
} from "@/features/workflow/actions/types";
