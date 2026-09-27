-- =============================================================================
-- 0026 — UN SEUL RÉGLAGE, UN SEUL ENDROIT
--
-- ⚠️ LA BASCULE RESEND ↔ SMTP N'A JAMAIS FONCTIONNÉ DEPUIS L'ÉCRAN.
--
-- `app_settings` porte des réglages en lignes clé/valeur — c'est ce que l'écran
-- Administration → Réglages lit et écrit. La migration 0014 a ajouté par-dessus
-- QUATRE COLONNES portant les mêmes réglages :
--
--     email_provider, notification_sender, weekly_digest_day, weekly_digest_hour
--
-- Le même réglage existait donc à deux endroits, et personne ne les tenait
-- d'accord. L'écran écrivait la LIGNE ; `loadNotificationSettings` lisait la
-- COLONNE. Changer le fournisseur depuis l'administration ne produisait aucun
-- effet — pas une erreur, pas un refus : un réglage qui s'enregistre, s'affiche
-- correctement ensuite, et ne change rien.
--
-- ⚠️ ET LA LECTURE ÉTAIT ARBITRAIRE. Les colonnes sont portées par CHAQUE ligne
-- de la table — vingt et une copies du même réglage, qu'aucune contrainte ne
-- forçait à rester égales. `loadNotificationSettings` faisait `limit(1).single()`
-- sans tri : il lisait une ligne quelconque. Une mise à jour partielle aurait
-- donné un réglage qui s'applique ou non selon la ligne que Postgres rend ce
-- jour-là.
--
-- On garde la représentation que l'écran manipule — les lignes — et l'on
-- supprime les colonnes. Une seule vérité, donc plus de divergence possible.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- SECTION 1 — RIEN NE SE PERD
--
-- Les valeurs portées par les colonnes rejoignent les lignes AVANT que les
-- colonnes ne disparaissent. `notification_sender` n'avait pas de ligne : elle
-- est créée ici avec la valeur réellement en service, pas avec un défaut.
-- -----------------------------------------------------------------------------

do $$
declare
  sender text;
  provider text;
begin
  -- `min()` plutôt qu'une ligne au hasard : si les copies divergeaient déjà,
  -- on veut un résultat déterministe et reproductible, pas un tirage.
  select min(notification_sender), min(email_provider)
    into sender, provider
  from public.app_settings;

  insert into public.app_settings (key, value, description, value_type)
  values (
    'notification_sender',
    to_jsonb(coalesce(sender, 'conformia@agroespace.dz')),
    'Adresse d''expédition des notifications. Doit appartenir au domaine vérifié chez le fournisseur.',
    'string')
  on conflict (key) do nothing;

  /*
   * ⚠️ LA LIGNE FAIT FOI, PAS LA COLONNE. Si les deux divergeaient, c'est la
   * ligne — celle que l'écran affiche et que l'administrateur croit avoir
   * réglée — qui est conservée. Restaurer la colonne reviendrait à annuler en
   * silence le dernier geste d'un utilisateur.
   */
  if not exists (select 1 from public.app_settings where key = 'email_provider') then
    insert into public.app_settings (key, value, description, value_type)
    values ('email_provider', to_jsonb(coalesce(provider, 'resend')),
            'Fournisseur d''envoi de courriel : resend ou smtp.', 'string');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- SECTION 2 — LES COLONNES DISPARAISSENT
-- -----------------------------------------------------------------------------

alter table public.app_settings
  drop column if exists email_provider,
  drop column if exists notification_sender,
  drop column if exists weekly_digest_day,
  drop column if exists weekly_digest_hour;

-- -----------------------------------------------------------------------------
-- SECTION 3 — LA LIGNE EST DÉSORMAIS CONTRÔLÉE
--
-- ⚠️ Une colonne portait une contrainte CHECK ; une ligne clé/valeur n'en a pas.
-- Sans remplacement, `email_provider` pourrait valoir « resnd » et la fabrique
-- de fournisseur tomberait sur un `switch` sans branche — au milieu d'un lot de
-- notifications, donc au pire moment.
-- -----------------------------------------------------------------------------

create or replace function public.app_settings_validate()
returns trigger
language plpgsql
as $fn$
begin
  if new.key = 'email_provider'
     and new.value #>> '{}' not in ('resend', 'smtp') then
    raise exception
      'email_provider doit valoir « resend » ou « smtp », reçu « % ».', new.value #>> '{}';
  end if;

  if new.key = 'weekly_digest_day'
     and (new.value #>> '{}')::int not between 1 and 7 then
    raise exception 'weekly_digest_day doit être entre 1 (lundi) et 7 (dimanche).';
  end if;

  if new.key = 'weekly_digest_hour'
     and (new.value #>> '{}')::int not between 0 and 23 then
    raise exception 'weekly_digest_hour doit être entre 0 et 23, en heure d''Alger.';
  end if;

  if new.key = 'notification_sender'
     and new.value #>> '{}' !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' then
    raise exception
      'notification_sender doit être une adresse de courriel valide, reçu « % ».',
      new.value #>> '{}';
  end if;

  if new.key = 'retention_default_years'
     and (new.value #>> '{}')::int not between 1 and 30 then
    raise exception 'retention_default_years doit être entre 1 et 30 ans.';
  end if;

  return new;
end;
$fn$;

comment on function public.app_settings_validate() is
  'Contrôle des réglages singuliers, en remplacement des contraintes CHECK que '
  'portaient les colonnes supprimées par 0026. ⚠️ Un réglage invalide accepté ici '
  'ne se manifeste qu''au milieu d''un lot de notifications — donc au pire moment '
  'et loin de la cause.';

drop trigger if exists app_settings_validate_trg on public.app_settings;
create trigger app_settings_validate_trg
  before insert or update on public.app_settings
  for each row execute function public.app_settings_validate();

-- -----------------------------------------------------------------------------
-- SECTION 4 — VÉRIFICATION
-- -----------------------------------------------------------------------------

do $$
declare
  manquants text[];
begin
  select array_agg(k) into manquants
  from unnest(array['email_provider', 'notification_sender',
                    'weekly_digest_day', 'weekly_digest_hour']) as k
  where not exists (select 1 from public.app_settings s where s.key = k);

  if manquants is not null then
    raise exception 'Réglages perdus à la migration : %.', array_to_string(manquants, ', ');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings'
      and column_name in ('email_provider', 'notification_sender',
                          'weekly_digest_day', 'weekly_digest_hour'))
  then
    raise exception 'Une colonne dupliquée subsiste : la divergence resterait possible.';
  end if;
end;
$$;

commit;
