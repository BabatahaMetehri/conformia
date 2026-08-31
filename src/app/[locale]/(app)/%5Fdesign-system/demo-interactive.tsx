"use client";

import { useTranslations } from "next-intl";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FileDropzone } from "@/components/shared/file-dropzone";
import { Button } from "@/components/ui/button";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_MB } from "@/config/constants";

/**
 * Demonstrations interactives.
 *
 * Regroupees dans un composant client parce que `ConfirmDialog` et
 * `FileDropzone` recoivent des FONCTIONS (`onConfirm`, `onFilesSelected`) :
 * une fonction ne traverse pas la frontiere serveur -> client, elle n'est pas
 * serialisable. La page reste un Server Component, seule cette ilot est cliente.
 */

export function DemoDialogs() {
  const t = useTranslations("designSystem");

  return (
    <div className="flex flex-wrap gap-3">
      <ConfirmDialog
        trigger={<Button variant="outline">Archiver le dossier</Button>}
        title="Archiver ce dossier ?"
        description="Le dossier passera en lecture seule. Il pourra etre rouvert par une personne habilitee."
        confirmLabel="Archiver"
        onConfirm={() => undefined}
      />
      <ConfirmDialog
        variant="destructive"
        confirmationWord="SUPPRIMER"
        trigger={<Button variant="destructive">{t("destructiveExample")}</Button>}
        title={t("destructiveExample")}
        description={t("destructiveDescription")}
        confirmLabel={t("destructiveExample")}
        onConfirm={() => undefined}
      />
    </div>
  );
}

export function DemoDropzone() {
  return (
    <FileDropzone
      accept={ALLOWED_MIME_TYPES}
      maxSizeMb={MAX_UPLOAD_MB}
      onFilesSelected={() => undefined}
    />
  );
}
