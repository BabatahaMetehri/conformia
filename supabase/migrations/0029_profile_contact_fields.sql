-- =============================================================================
-- 0029 — UN COMPTE PORTE SES COORDONNÉES
--
-- ⚠️ LES COLONNES EXISTAIENT, RIEN NE POUVAIT LES REMPLIR.
--
-- `profiles.phone` et `profiles.job_title` sont posées depuis la migration 0018.
-- L'écran de profil AFFICHE même la fonction. Mais aucun formulaire, aucune
-- action, aucun service ne les écrit : elles sont restées nulles sur tous les
-- comptes depuis l'origine.
--
-- C'est le genre de manque qui ne se signale jamais — un champ vide ressemble à
-- un champ qu'on n'a pas encore rempli, jamais à un champ qu'on ne PEUT pas
-- remplir. On s'en aperçoit le jour où l'on cherche le numéro du responsable
-- d'un dossier en retard, et qu'il n'y en a nulle part.
--
-- L'invitation les porte désormais, et le profil les reçoit à l'acceptation.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- SECTION 1 — L'INVITATION PORTE LES COORDONNÉES
--
-- C'est à l'invitation qu'elles se saisissent, pas après : l'administrateur qui
-- crée le compte a la fiche de la personne sous les yeux. Demander de repasser
-- plus tard sur chaque compte revient à ne jamais le faire.
-- -----------------------------------------------------------------------------

alter table public.user_invitations
  add column if not exists phone text,
  add column if not exists job_title text;

comment on column public.user_invitations.phone is
  'Téléphone professionnel, reporté sur le profil à l''acceptation. Facultatif : '
  'refuser une invitation faute de numéro empêcherait de créer un compte pour '
  'quelqu''un qu''on joint autrement.';
comment on column public.user_invitations.job_title is
  'Fonction dans l''entreprise. Informative : elle n''ouvre AUCUN droit — les '
  'droits viennent du rôle, et d''eux seuls. La confondre avec le rôle est '
  'l''erreur qui fait croire qu''un « Directeur financier » peut valider.';

-- -----------------------------------------------------------------------------
-- SECTION 2 — LE PROFIL LES REÇOIT
--
-- ⚠️ LE RAPPROCHEMENT SE FAIT PAR ADRESSE, EN MINUSCULES. Une invitation saisie
-- « Ahmed@agroespace.dz » et une inscription « ahmed@agroespace.dz » désignent
-- la même personne ; comparer sans normaliser laisserait le profil vide sans
-- rien dire.
--
-- ⚠️ ET SEULEMENT UNE INVITATION VIVANTE. Une invitation annulée ou expirée ne
-- doit pas renseigner un compte : si elle a été annulée, c'est qu'on ne voulait
-- plus de ces informations-là.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  invitation public.user_invitations%rowtype;
begin
  select * into invitation
  from public.user_invitations i
  where lower(i.email) = lower(new.email)
    and i.cancelled_at is null
    and i.accepted_at is null
    and i.expires_at > now()
  order by i.created_at desc
  limit 1;

  insert into public.profiles (id, email, full_name, phone, job_title, department_id)
  values (
    new.id,
    new.email,
    /*
     * Le nom saisi par la personne elle-même l'emporte sur celui de
     * l'invitation : c'est elle qui sait comment elle s'appelle. L'invitation
     * ne sert que de valeur de repli.
     */
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
      nullif(btrim(coalesce(invitation.full_name, '')), '')),
    nullif(btrim(coalesce(invitation.phone, '')), ''),
    nullif(btrim(coalesce(invitation.job_title, '')), ''),
    invitation.department_id
  )
  on conflict (id) do nothing;

  return new;
end;
$fn$;

comment on function public.handle_new_auth_user() is
  'Crée le profil à l''inscription, en reprenant les coordonnées de l''invitation '
  'vivante correspondant à l''adresse. ⚠️ Le rapprochement est fait EN MINUSCULES : '
  'une casse différente laisserait le profil vide sans rien signaler.';

commit;
