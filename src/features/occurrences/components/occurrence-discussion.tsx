"use client";

import { AtSign, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/states";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { postCommentAction, removeCommentAction } from "@/features/occurrences/actions/detail";
import type { AssignableProfile } from "@/features/occurrences/components/types";
import { formatDateTimeFr } from "@/lib/dates";
import type { OccurrenceDetailView } from "@/services/occurrences/detail";
import { useActionRunner } from "@/hooks/use-action-runner";

/**
 * Onglet « Discussion ».
 *
 * ⚠️ Les mentions sont ENREGISTRÉES, pas encore notifiées : aucun canal de
 * notification n'existe à ce stade du projet. `mentioned_user_ids` est exactement
 * ce que le job de notification lira le jour venu — écrire la donnée maintenant
 * évite d'avoir à reconstruire l'historique plus tard.
 *
 * La suppression est LOGIQUE : la ligne survit et l'audit conserve son texte. Le
 * fil, lui, ne montre pas de pierre tombale — un « message supprimé » n'apprend
 * rien à personne et encombre une conversation de travail.
 */
export function OccurrenceDiscussion({
  detail,
  directory,
}: {
  readonly detail: OccurrenceDetailView;
  readonly directory: readonly AssignableProfile[];
}) {
  const t = useTranslations("occurrences.detail");
  const [isPending, run] = useActionRunner();
  const [body, setBody] = useState("");

  /**
   * Mentions détectées dans le texte.
   *
   * Le rapprochement se fait sur le nom complet, insensible à la casse et aux
   * espaces : `@Amina Belkacem` comme `@amina belkacem`. Seules les personnes de
   * l'annuaire — donc déjà visibles de l'auteur — peuvent être citées.
   */
  const mentioned = useMemo(() => {
    const haystack = body.toLowerCase();
    return directory.filter((profile) => haystack.includes(`@${profile.fullName.toLowerCase()}`));
  }, [body, directory]);

  function submit(): void {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;

    run(async () => {
      const outcome = await postCommentAction({
        occurrenceId: detail.id,
        body: trimmed,
        mentionedUserIds: mentioned.map((profile) => profile.id),
      });

      if (outcome.status === "error") {
        toast.error(t("commentFailed"));
        return;
      }
      setBody("");
    });
  }

  return (
    <div className="space-y-4">
      {detail.comments.length === 0 ? (
        <EmptyState title={t("noComments")} description={t("noCommentsHint")} />
      ) : (
        <ul className="space-y-3">
          {detail.comments.map((comment) => (
            <li key={comment.id} className="flex gap-3 rounded-lg border border-border p-3">
              <UserAvatar fullName={comment.authorName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-text-primary">{comment.authorName ?? "—"}</span>
                  <span className="text-xs text-text-muted">
                    {formatDateTimeFr(new Date(comment.createdAt))}
                  </span>
                  {comment.mentionedUserIds.length === 0 ? null : (
                    <Badge variant="outline">
                      <AtSign aria-hidden="true" className="size-3" />
                      {comment.mentionedUserIds.length}
                    </Badge>
                  )}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-text-secondary">
                  {comment.body}
                </p>
              </div>

              {comment.isMine ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  aria-label={t("removeComment")}
                  onClick={() => {
                    run(async () => {
                      const outcome = await removeCommentAction(comment.id);
                      if (outcome.status === "error") {
                        toast.error(t("commentFailed"));
                        return;
                      }
                    });
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="new-comment">{t("newComment")}</Label>
        <Textarea
          id="new-comment"
          rows={3}
          value={body}
          placeholder={t("newCommentPlaceholder")}
          aria-describedby="new-comment-hint"
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
        <p id="new-comment-hint" className="text-xs text-text-muted">
          {t("mentionHint")}
        </p>

        {mentioned.length === 0 ? null : (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
            {t("willNotify")}
            {mentioned.map((profile) => (
              <Badge key={profile.id} variant="outline">
                {profile.fullName}
              </Badge>
            ))}
          </p>
        )}

        <div className="flex justify-end">
          <Button size="sm" disabled={isPending || body.trim().length === 0} onClick={submit}>
            {isPending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {t("postComment")}
          </Button>
        </div>
      </div>
    </div>
  );
}
