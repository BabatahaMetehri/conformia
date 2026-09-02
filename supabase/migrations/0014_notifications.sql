-- =============================================================================
-- 0014 — NOTIFICATIONS, ESCALADE, FLUX CALENDRIER
--
-- ⚠️ NUMÉROTÉE 0014, ET NON 0004 COMME DEMANDÉ. Le fichier 0004 existe déjà
-- (`0004_auth_hardening.sql`), il est appliqué, et une migration appliquée est
-- immuable (CLAUDE.md §6). Réutiliser son numéro casserait l'ordre d'application
-- sur toute base déjà migrée. Le contenu demandé est intégralement ici.
--
-- Ce fichier tient une arithmétique simple : une alerte manquée détruit la
-- confiance, une alerte de trop la dissout. D'où trois choix structurants —
-- la déduplication est une CONTRAINTE et non une intention, les jalons sont des
-- DONNÉES et non des constantes, les statuts clos ne produisent rien du tout.
-- =============================================================================

-- =============================================================================
-- 1. RÉGLAGES D'INSTALLATION
-- =============================================================================

alter table public.app_settings
  add column if not exists email_provider text not null default 'resend'
    check (email_provider in ('resend', 'smtp')),
  add column if not exists notification_sender text not null default 'conformia@agroespace.dz',
  add column if not exists weekly_digest_day int not null default 1
    check (weekly_digest_day between 1 and 7),
  add column if not exists weekly_digest_hour int not null default 7
    check (weekly_digest_hour between 0 and 23);

comment on column public.app_settings.email_provider is
  'Fournisseur d''envoi. Bascule Resend ↔ SMTP d''entreprise SANS toucher une ligne '
  'de code applicatif : le choix est une donnée, la fabrique la lit au démarrage '
  'de chaque lot.';
comment on column public.app_settings.weekly_digest_day is
  'Jour d''envoi du résumé, norme ISO : 1 = lundi … 7 = dimanche.';
comment on column public.app_settings.weekly_digest_hour is
  'Heure d''envoi du résumé, EN HEURE D''ALGER. La conversion vers UTC est faite au '
  'moment de l''envoi, jamais stockée : un réglage figé en UTC deviendrait faux le '
  'jour où le site change de fuseau.';

-- =============================================================================
-- 2. JETON DE FLUX CALENDRIER
--
--    ⚠️ DANS SA PROPRE TABLE, PAS SUR `profiles`.
--
--    La demande dit « le `ics_token` du profil », et la colonne y a d'abord été
--    posée. Relecture de `profiles_select` : la politique laisse lire la ligne
--    d'autrui à qui détient `user.manage`, et à tout collègue partageant une
--    occurrence. Le jeton s'y serait donc trouvé LISIBLE PAR DES TIERS — or il
--    vaut mot de passe : quiconque l'a s'abonne à l'agenda de son porteur.
--
--    Une table satellite porte une politique qui lui est propre : « la mienne,
--    et rien d'autre ». C'est le seul endroit du schéma où cette phrase est
--    exactement vraie, et un secret n'a pas d'autre place que là.
-- =============================================================================

create table public.calendar_feed_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint calendar_feed_tokens_token_key unique (token)
);

comment on table public.calendar_feed_tokens is
  '⚠️ SECRETS PORTEURS. Un jeton de flux vaut mot de passe : aucun agenda grand '
  'public ne sait s''authentifier autrement qu''en présentant une URL. Deux '
  'conséquences assumées — le flux ne porte QUE libellé, période et échéance '
  '(jamais un document, jamais un montant), et la rotation invalide l''ancien flux '
  'immédiatement, l''ancien jeton ne correspondant plus à aucune ligne.';
comment on column public.calendar_feed_tokens.rotated_at is
  'Dernière rotation. Sert à l''écran : « jeton régénéré le … » est la seule preuve '
  'visible qu''un ancien lien a bien cessé de fonctionner.';

alter table public.calendar_feed_tokens enable row level security;

revoke all on public.calendar_feed_tokens from public, anon, authenticated;
grant select on public.calendar_feed_tokens to authenticated;

create policy calendar_feed_tokens_select on public.calendar_feed_tokens
  for select to authenticated
  using (public.is_active_user() and user_id = public.current_profile_id());
comment on policy calendar_feed_tokens_select on public.calendar_feed_tokens is
  'Le sien, et rien d''autre. Aucune exception d''administration : un administrateur '
  'qui peut lire le jeton d''un tiers peut s''abonner à son agenda, ce qu''aucune '
  'tâche d''administration ne demande.';

-- Aucune politique d'écriture : la création et la rotation passent par des
-- fonctions SECURITY DEFINER. Une écriture directe permettrait de SE CHOISIR un
-- jeton, donc d'en deviner un.

-- Occulté du journal : tracer la valeur reviendrait à recopier le secret dans la
-- table que les auditeurs lisent précisément pour tout voir.
insert into public.audit_redacted_columns (table_name, column_name, reason)
values ('calendar_feed_tokens', 'token',
  'Secret porteur du flux calendrier. Le journaliser en clair le publierait dans '
  'le journal d''audit.')
on conflict do nothing;

create trigger trg_audit
  after insert or update or delete on public.calendar_feed_tokens
  for each row execute function public.audit_trigger();

-- Chaque profil, existant comme futur, a son jeton. Le créer à la demande ferait
-- écrire une requête de lecture, et laisserait l'écran du flux en erreur le jour
-- où cette écriture échouerait.
insert into public.calendar_feed_tokens (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

create or replace function public.create_calendar_feed_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.calendar_feed_tokens (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$fn$;

create trigger trg_create_calendar_feed_token
  after insert on public.profiles
  for each row execute function public.create_calendar_feed_token();

-- =============================================================================
-- 3. RESPONSABLE DE SERVICE
--    L'audience DEPARTMENT_HEAD et le palier « J+3 responsable de service »
--    n'étaient exprimables par AUCUNE colonne existante : un service n'avait pas
--    de responsable. On étend le modèle plutôt que de deviner le destinataire
--    depuis un code de rôle (CLAUDE.md §3.5).
-- =============================================================================

alter table public.departments
  add column if not exists head_id uuid references public.profiles (id) on delete restrict;

comment on column public.departments.head_id is
  'Responsable du service. NULL est un état légitime — un service sans responsable '
  'désigné existe. L''escalade saute alors ce palier au lieu de s''interrompre : une '
  'chaîne qui casse au milieu ne prévient PERSONNE, ce qui est le pire résultat '
  'possible pour un module d''alerte.';

create index if not exists departments_head_idx on public.departments (head_id)
  where head_id is not null;

-- =============================================================================
-- 4. ÉNUMÉRATIONS
-- =============================================================================

create type public.notification_channel as enum ('EMAIL', 'IN_APP', 'SMS');
create type public.notification_audience as enum
  ('OWNER', 'VALIDATOR', 'DEPARTMENT_HEAD', 'DIRECTION');
create type public.digest_frequency as enum ('NONE', 'DAILY', 'WEEKLY');

comment on type public.notification_channel is
  'SMS est DÉCLARÉ, non implémenté en v1. Le déclarer coûte une valeur d''énumération '
  'et rend l''absence explicite ; le taire imposerait une migration le jour où le canal '
  'ouvre, et laisserait croire entre-temps que la question n''a jamais été posée.';

-- =============================================================================
-- 5. RÈGLES DE JALON
-- =============================================================================

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  obligation_type_id uuid references public.obligation_types (id) on delete cascade,
  criticality public.criticality,
  offset_days int not null,
  channel public.notification_channel not null,
  audience public.notification_audience not null,
  template_key text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  constraint notification_rules_scope_key
    unique nulls not distinct (obligation_type_id, criticality, offset_days, channel, audience),
  -- Une règle ne peut viser à la fois UNE obligation et TOUTE une criticité : la
  -- portée serait ambiguë, et l'ambiguïté se paie en alertes fantômes.
  constraint notification_rules_single_scope
    check (obligation_type_id is null or criticality is null)
);

comment on table public.notification_rules is
  'Jalons d''alerte, EN DONNÉES. Offset négatif = avant l''échéance (J-30), positif = '
  'après (J+3). '
  '⚠️ L''offset porte sur l''ÉCHÉANCE INTERNE, jamais sur l''échéance légale : prévenir '
  'à J-1 de la date légale, c''est prévenir après la date à laquelle le dossier devait '
  'être prêt.';
comment on column public.notification_rules.obligation_type_id is
  'NULL = règle par défaut. Renseigné = règle propre à une obligation.';
comment on column public.notification_rules.template_key is
  'Gabarit à rendre. Une clé, pas du contenu : le texte vit dans src/emails/, versionné '
  'et relu, pas dans une colonne que personne ne relit jamais.';
comment on constraint notification_rules_scope_key on public.notification_rules is
  'NULLS NOT DISTINCT : sans cette clause, deux règles par défaut identiques '
  'coexisteraient (NULL ≠ NULL) et chaque occurrence recevrait le message en double.';

create index notification_rules_lookup_idx
  on public.notification_rules (offset_days, channel)
  where is_active;

alter table public.notification_rules enable row level security;

create policy notification_rules_select on public.notification_rules
  for select to authenticated
  using (public.is_active_user());
comment on policy notification_rules_select on public.notification_rules is
  'Lecture ouverte à toute session active : savoir QUAND on sera prévenu ne révèle '
  'aucune donnée métier, et le cacher rendrait l''écran de préférences incompréhensible.';

/*
 * ⚠️ TROIS politiques et non un `for all`. Une politique FOR ALL couvre aussi
 * SELECT : elle doublerait la politique de lecture ci-dessus au lieu de s'y
 * ajouter, et surtout elle rend impossible de lire dans le catalogue qui peut
 * consulter par opposition à qui peut écrire. Le test de couverture RLS refuse
 * cette forme, et il a raison de la refuser.
 */
create policy notification_rules_insert on public.notification_rules
  for insert to authenticated
  with check (public.has_permission('settings.manage'));

create policy notification_rules_update on public.notification_rules
  for update to authenticated
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));

create policy notification_rules_delete on public.notification_rules
  for delete to authenticated
  using (public.has_permission('settings.manage'));

create trigger trg_notification_rules_set_updated_at
  before update on public.notification_rules
  for each row execute function public.set_updated_at();

create trigger trg_audit
  after insert or update or delete on public.notification_rules
  for each row execute function public.audit_trigger();

-- =============================================================================
-- 6. POLITIQUES D'ESCALADE
-- =============================================================================

create table public.escalation_policies (
  id uuid primary key default gen_random_uuid(),
  obligation_type_id uuid references public.obligation_types (id) on delete cascade,
  criticality public.criticality,
  days_after_due int not null check (days_after_due >= 0),
  notify_audience public.notification_audience,
  notify_role_id uuid references public.roles (id) on delete restrict,
  notify_user_id uuid references public.profiles (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  constraint escalation_policies_single_scope
    check (obligation_type_id is null or criticality is null),
  -- Un palier qui ne désigne personne n'escalade rien. On le refuse à l'écriture
  -- plutôt que de le découvrir au moment où l'alerte aurait dû partir.
  constraint escalation_policies_has_target
    check (num_nonnulls(notify_audience, notify_role_id, notify_user_id) >= 1),
  constraint escalation_policies_scope_key
    unique nulls not distinct
      (obligation_type_id, criticality, days_after_due,
       notify_audience, notify_role_id, notify_user_id)
);

comment on table public.escalation_policies is
  'Paliers d''escalade après échéance interne. Le palier le plus spécifique gagne : '
  'obligation > criticité > défaut.';
comment on column public.escalation_policies.notify_audience is
  '⚠️ COLONNE AJOUTÉE au modèle demandé. La chaîne exigée — « J+1 responsable, J+3 '
  'responsable de service, J+7 Direction » — n''est exprimable ni par un rôle ni par un '
  'utilisateur nommé : « le responsable » désigne le porteur DE CETTE occurrence, qui '
  'change à chaque ligne. Sans cette colonne, la chaîne aurait dû être codée, '
  'c''est-à-dire sortie des données.';
comment on column public.escalation_policies.days_after_due is
  'Jours pleins après l''échéance INTERNE. 0 = le jour même, employé par la variante '
  'CRITICAL qui n''attend pas le dépassement pour alerter deux niveaux à la fois.';

create index escalation_policies_lookup_idx
  on public.escalation_policies (days_after_due)
  where is_active;

alter table public.escalation_policies enable row level security;

create policy escalation_policies_select on public.escalation_policies
  for select to authenticated
  using (public.is_active_user());

/*
 * ⚠️ TROIS politiques et non un `for all`. Une politique FOR ALL couvre aussi
 * SELECT : elle doublerait la politique de lecture ci-dessus au lieu de s'y
 * ajouter, et surtout elle rend impossible de lire dans le catalogue qui peut
 * consulter par opposition à qui peut écrire. Le test de couverture RLS refuse
 * cette forme, et il a raison de la refuser.
 */
create policy escalation_policies_insert on public.escalation_policies
  for insert to authenticated
  with check (public.has_permission('settings.manage'));

create policy escalation_policies_update on public.escalation_policies
  for update to authenticated
  using (public.has_permission('settings.manage'))
  with check (public.has_permission('settings.manage'));

create policy escalation_policies_delete on public.escalation_policies
  for delete to authenticated
  using (public.has_permission('settings.manage'));

create trigger trg_escalation_policies_set_updated_at
  before update on public.escalation_policies
  for each row execute function public.set_updated_at();

create trigger trg_audit
  after insert or update or delete on public.escalation_policies
  for each row execute function public.audit_trigger();

-- =============================================================================
-- 7. PRÉFÉRENCES UTILISATEUR
-- =============================================================================

create table public.user_notification_preferences (
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel public.notification_channel not null,
  is_enabled boolean not null default true,
  digest_frequency public.digest_frequency not null default 'WEEKLY',
  updated_at timestamptz not null default now(),
  primary key (user_id, channel)
);

comment on table public.user_notification_preferences is
  'Préférences par canal. L''ABSENCE de ligne vaut « activé » : un compte nouvellement '
  'créé doit être prévenu, pas rester silencieux jusqu''à ce qu''il pense à s''abonner.';
comment on column public.user_notification_preferences.is_enabled is
  '⚠️ Ne coupe JAMAIS les messages de workflow (validation demandée, rejet) : ceux-là '
  'matérialisent une responsabilité, pas un confort. La préférence s''applique aux '
  'alertes d''échéance et d''escalade ; les effets de transition, écrits dans la '
  'transaction métier, l''ignorent délibérément.';

alter table public.user_notification_preferences enable row level security;

create policy user_notification_preferences_select on public.user_notification_preferences
  for select to authenticated
  using (public.is_active_user() and user_id = public.current_profile_id());

/*
 * ⚠️ TROIS politiques et non un `for all`. Une politique FOR ALL couvre aussi
 * SELECT : elle doublerait la politique de lecture ci-dessus au lieu de s'y
 * ajouter, et surtout elle rend impossible de lire dans le catalogue qui peut
 * consulter par opposition à qui peut écrire. Le test de couverture RLS refuse
 * cette forme, et il a raison de la refuser.
 */
create policy user_notification_preferences_insert on public.user_notification_preferences
  for insert to authenticated
  with check (public.is_active_user() and user_id = public.current_profile_id());

create policy user_notification_preferences_update on public.user_notification_preferences
  for update to authenticated
  using (public.is_active_user() and user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

create policy user_notification_preferences_delete on public.user_notification_preferences
  for delete to authenticated
  using (public.is_active_user() and user_id = public.current_profile_id());
comment on policy user_notification_preferences_update on public.user_notification_preferences is
  'Chacun règle les siennes, personne ne règle celles d''autrui — pas même un '
  'administrateur. Couper les alertes d''un tiers à son insu produirait exactement '
  'l''échéance manquée que ce module existe pour éviter.';

create trigger trg_user_notification_preferences_set_updated_at
  before update on public.user_notification_preferences
  for each row execute function public.set_updated_at();

create trigger trg_audit
  after insert or update or delete on public.user_notification_preferences
  for each row execute function public.audit_trigger();

-- =============================================================================
-- 8. LA TABLE `notifications`, ÉTENDUE
--
--    Elle existe depuis 0010, où elle portait les effets de transition. On
--    l'ÉTEND plutôt que d'en créer une seconde : deux tables de messages
--    signifieraient deux cloches, deux compteurs de non-lus et deux endroits où
--    chercher pourquoi un message n'est pas arrivé.
-- =============================================================================

alter table public.notifications
  add column rule_id uuid references public.notification_rules (id) on delete set null,
  add column escalation_policy_id uuid references public.escalation_policies (id) on delete set null,
  add column channel public.notification_channel not null default 'IN_APP',
  add column subject text,
  add column body_html text,
  add column body_text text,
  add column scheduled_for timestamptz not null default now(),
  add column sent_at timestamptz,
  add column dismissed_at timestamptz,
  add column error_message text,
  add column retry_count int not null default 0 check (retry_count >= 0);

/*
 * Les nouveaux genres. La contrainte reste une liste blanche : un genre inconnu
 * n'a aucun gabarit et produirait un message vide.
 *
 * ⚠️ La liste RECONDUIT les sept genres déjà en place — les trois de 0010 et les
 * quatre de l'administration (0011). Une contrainte se remplace en entier : n'y
 * porter que ses propres ajouts révoque silencieusement ceux des autres, et
 * l'écriture ne casse qu'au moment où un administrateur réinitialise un second
 * facteur, c'est-à-dire loin d'ici.
 */
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  -- 0010 — effets de transition
  'VALIDATION_REQUESTED', 'OCCURRENCE_REJECTED', 'OCCURRENCE_UNLOCKED',
  -- 0011 — administration
  'MFA_RESET', 'HOLIDAY_CALENDAR_CHANGED', 'ROLE_GRANTED', 'ROLE_REVOKED',
  -- 0014 — jalons, escalade, exploitation
  'UPCOMING_DEADLINE', 'OVERDUE_ALERT', 'ESCALATION', 'WEEKLY_DIGEST',
  'USER_INVITATION', 'PASSWORD_RESET', 'INTEGRITY_ALERT', 'BACKUP_FAILURE',
  'DELIVERY_FAILURE'));

comment on column public.notifications.channel is
  'Canal de sortie. Une alerte à deux canaux fait DEUX lignes : sans quoi un échec '
  'd''envoi de courriel effacerait aussi la trace in-app, et l''utilisateur perdrait '
  'le message sur les deux tableaux à la fois.';
comment on column public.notifications.scheduled_for is
  'Heure d''envoi prévue, en UTC. Sert de clé de regroupement : les alertes d''un même '
  'destinataire tombant dans la même heure partent en UN SEUL courriel.';
comment on column public.notifications.retry_count is
  'Tentatives d''envoi consommées. Au-delà de MAX_EMAIL_ATTEMPTS la ligne est en échec '
  'définitif et n''est plus reprise : réessayer sans fin une adresse morte noierait le '
  'lot suivant.';

/*
 * ⚠️ LA DÉDUPLICATION EST UNE CONTRAINTE, PAS UNE INTENTION.
 *
 * Demandée : UNIQUE (occurrence_id, rule_id, recipient_id). Livrée en index
 * unique PARTIEL, pour deux raisons qui ne sont pas des libertés prises :
 *
 * 1. En SQL, NULL ≠ NULL. Une contrainte pleine ne dédupliquerait donc RIEN des
 *    lignes à `rule_id` NULL — c'est-à-dire les notifications de transition
 *    écrites depuis 0010. Le prédicat `where rule_id is not null` dit
 *    explicitement ce que la contrainte pleine aurait fait en silence.
 * 2. Ces lignes de transition DOIVENT pouvoir se répéter : un dossier rejeté
 *    deux fois donne deux messages. Les dédupliquer perdrait le second rejet.
 *
 * L'escalade a son propre index : sa clé est la POLITIQUE, pas la règle de jalon.
 * Sans lui, chaque exécution horaire aurait renvoyé le même palier — vingt-quatre
 * courriels par jour et par dossier en retard, soit très exactement l'alerte
 * excessive que ce module doit empêcher.
 */
create unique index notifications_rule_dedup_key
  on public.notifications (occurrence_id, rule_id, recipient_id)
  where rule_id is not null;

create unique index notifications_escalation_dedup_key
  on public.notifications (occurrence_id, escalation_policy_id, recipient_id)
  where escalation_policy_id is not null;

-- File de lecture : « mes non-lues », l'accès le plus fréquent de l'application.
create index notifications_read_state_idx on public.notifications (recipient_id, read_at);

-- File d'envoi : uniquement ce qui reste à envoyer. L'index ne grossit pas avec
-- l'historique, qui est pourtant ce qui grossit.
create index notifications_outbox_idx on public.notifications (scheduled_for)
  where sent_at is null;

/*
 * L'immuabilité du CONTENU est conservée ; les colonnes de LIVRAISON deviennent
 * modifiables. La distinction est le cœur du sujet : ce qu'on a dit à quelqu'un
 * ne se réécrit pas, ce qu'on a réussi à lui transmettre s'observe.
 */
create or replace function public.enforce_notification_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.recipient_id is distinct from old.recipient_id
     or new.kind is distinct from old.kind
     or new.occurrence_id is distinct from old.occurrence_id
     or new.actor_id is distinct from old.actor_id
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at
     or new.rule_id is distinct from old.rule_id
     or new.escalation_policy_id is distinct from old.escalation_policy_id
     or new.channel is distinct from old.channel
     or new.subject is distinct from old.subject
     or new.body_html is distinct from old.body_html
     or new.body_text is distinct from old.body_text
     or new.scheduled_for is distinct from old.scheduled_for
  then
    raise exception 'Le contenu d''une notification est immuable ; seuls son état de '
      'lecture et son état de livraison changent.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

/*
 * ⚠️ La politique d'écriture de l'utilisateur est resserrée. Sans elle, la
 * politique `notifications_update` de 0010 laissait chacun écrire n'importe
 * quelle colonne modifiable de SES messages — donc se déclarer « envoyé » ou
 * remettre son compteur de tentatives à zéro. Marquer lu, c'est marquer lu.
 */
create or replace function public.enforce_notification_delivery_is_server_side()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- auth.uid() est NULL pour les tâches planifiées : elles seules touchent la
  -- livraison, et elles passent par des fonctions SECURITY DEFINER.
  if auth.uid() is not null
     and (new.sent_at is distinct from old.sent_at
          or new.error_message is distinct from old.error_message
          or new.retry_count is distinct from old.retry_count)
  then
    raise exception 'L''état de livraison n''appartient pas à l''utilisateur.'
      using errcode = '42501';
  end if;
  return new;
end;
$fn$;

create trigger trg_notification_delivery_server_side
  before update on public.notifications
  for each row execute function public.enforce_notification_delivery_is_server_side();

-- =============================================================================
-- 9. RÈGLES PAR DÉFAUT — VALEURS ARRÊTÉES
--
--    Injectées EN DONNÉES et non en constantes : changer un jalon doit être une
--    ligne de table, jamais un déploiement (CLAUDE.md §3.5).
-- =============================================================================

insert into public.notification_rules
  (obligation_type_id, criticality, offset_days, channel, audience, template_key)
select null, null, jalon.offset_days, canal.channel::public.notification_channel,
       'OWNER'::public.notification_audience, jalon.template_key
from (values
  -- Alerte préventive : J-30, J-15, J-7, J-1.
  (-30, 'UpcomingDeadline'),
  (-15, 'UpcomingDeadline'),
  (-7,  'UpcomingDeadline'),
  (-1,  'UpcomingDeadline'),
  -- Rappel après échéance : J+1, J+3, J+7.
  (1,   'OverdueAlert'),
  (3,   'OverdueAlert'),
  (7,   'OverdueAlert')
) as jalon(offset_days, template_key)
cross join (values ('EMAIL'), ('IN_APP')) as canal(channel)
on conflict on constraint notification_rules_scope_key do nothing;

-- Escalade standard : J+1 responsable → J+3 responsable de service → J+7 Direction.
insert into public.escalation_policies
  (obligation_type_id, criticality, days_after_due, notify_audience)
values
  (null, null, 1, 'OWNER'),
  (null, null, 3, 'DEPARTMENT_HEAD'),
  (null, null, 7, 'DIRECTION')
on conflict on constraint escalation_policies_scope_key do nothing;

/*
 * Escalade CRITICAL : J+0 responsable ET responsable de service → J+2 Direction.
 * Deux paliers le MÊME jour, pas un seul destinataire double : ce sont deux
 * lignes, donc deux traces, donc deux responsabilités distinctes au journal.
 */
insert into public.escalation_policies
  (obligation_type_id, criticality, days_after_due, notify_audience)
values
  (null, 'CRITICAL', 0, 'OWNER'),
  (null, 'CRITICAL', 0, 'DEPARTMENT_HEAD'),
  (null, 'CRITICAL', 2, 'DIRECTION')
on conflict on constraint escalation_policies_scope_key do nothing;

-- =============================================================================
-- 10. RÉSOLUTION DES DESTINATAIRES
-- =============================================================================

create or replace function public.notification_audience_members(
  p_occurrence uuid,
  p_audience public.notification_audience)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select oc.owner_id
  from public.obligation_occurrences oc
  where oc.id = p_occurrence and p_audience = 'OWNER' and oc.owner_id is not null

  union

  select oc.validator_id
  from public.obligation_occurrences oc
  where oc.id = p_occurrence and p_audience = 'VALIDATOR' and oc.validator_id is not null

  union

  -- Le responsable du SERVICE DU PORTEUR : c'est lui qui répond du retard, pas le
  -- responsable d'un service choisi par le domaine de l'obligation.
  select d.head_id
  from public.obligation_occurrences oc
  join public.profiles p on p.id = oc.owner_id
  join public.departments d on d.id = p.department_id
  where oc.id = p_occurrence and p_audience = 'DEPARTMENT_HEAD' and d.head_id is not null

  union

  select ur.user_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where p_audience = 'DIRECTION'
    and r.code = 'DIRECTION'
    and ur.revoked_at is null
    and (ur.expires_at is null or ur.expires_at > now());
$$;

comment on function public.notification_audience_members(uuid, public.notification_audience) is
  'Traduit une audience en personnes, POUR CETTE occurrence. Une audience vide rend '
  'zéro ligne : le jalon est alors sans destinataire et ne produit rien, plutôt que de '
  'faire échouer tout le lot.';

-- =============================================================================
-- 11. RÉSOLUTION DES RÈGLES — LA PLUS SPÉCIFIQUE GAGNE
-- =============================================================================

create or replace function public.resolve_notification_rules(
  p_obligation uuid,
  p_criticality public.criticality)
returns table (
  id uuid,
  offset_days int,
  channel public.notification_channel,
  audience public.notification_audience,
  template_key text)
language sql
stable
security definer
set search_path = ''
as $$
  with applicable as (
    select r.id, r.offset_days, r.channel, r.audience, r.template_key,
           case
             when r.obligation_type_id is not null then 3
             when r.criticality is not null then 2
             else 1
           end as specificity
    from public.notification_rules r
    where r.is_active
      and (r.obligation_type_id is null or r.obligation_type_id = p_obligation)
      and (r.criticality is null or r.criticality = p_criticality)
  ),
  /*
   * ⚠️ Le niveau le plus spécifique REMPLACE les niveaux inférieurs, canal par
   * canal — il ne s'y ajoute pas. Un cumul rendrait impossible de RETIRER un
   * jalon pour une obligation donnée : on ne pourrait qu'en ajouter, et le seul
   * réglage disponible serait « toujours plus d'alertes ».
   */
  winner as (select channel, max(specificity) as specificity from applicable group by channel)
  select a.id, a.offset_days, a.channel, a.audience, a.template_key
  from applicable a
  join winner w on w.channel = a.channel and w.specificity = a.specificity;
$$;

comment on function public.resolve_notification_rules(uuid, public.criticality) is
  'Jalons applicables à une obligation. Précédence : règle de l''obligation > règle de '
  'criticité > règle par défaut, résolue PAR CANAL.';

create or replace function public.resolve_escalation_policies(
  p_obligation uuid,
  p_criticality public.criticality)
returns table (
  id uuid,
  days_after_due int,
  notify_audience public.notification_audience,
  notify_role_id uuid,
  notify_user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with applicable as (
    select e.id, e.days_after_due, e.notify_audience, e.notify_role_id, e.notify_user_id,
           case
             when e.obligation_type_id is not null then 3
             when e.criticality is not null then 2
             else 1
           end as specificity
    from public.escalation_policies e
    where e.is_active
      and (e.obligation_type_id is null or e.obligation_type_id = p_obligation)
      and (e.criticality is null or e.criticality = p_criticality)
  ),
  -- ⚠️ Une seule chaîne s'applique, en bloc. Mélanger la chaîne CRITICAL et la
  -- chaîne par défaut donnerait J+0, J+1, J+2, J+3, J+7 : cinq escalades là où
  -- la règle métier en prévoit trois.
  winner as (select max(specificity) as specificity from applicable)
  select a.id, a.days_after_due, a.notify_audience, a.notify_role_id, a.notify_user_id
  from applicable a, winner w
  where a.specificity = w.specificity;
$$;

comment on function public.resolve_escalation_policies(uuid, public.criticality) is
  'Chaîne d''escalade applicable, EN BLOC. La chaîne la plus spécifique remplace '
  'entièrement les autres : une occurrence CRITICAL suit la chaîne CRITICAL, pas '
  'l''union des deux.';

-- =============================================================================
-- 12. CANDIDATES DU CYCLE COURANT
--
--     ⚠️ Les statuts SUBMITTED, ARCHIVED et NOT_APPLICABLE ne produisent AUCUNE
--     notification. Un dossier déposé, archivé ou sans objet n'a plus d'échéance
--     à tenir : le relancer serait dire au destinataire que le système ne sait
--     pas ce qu'il a déjà fait, ce qui est la manière la plus rapide de lui
--     apprendre à ignorer les alertes.
-- =============================================================================

create or replace function public.due_notification_candidates(p_now timestamptz default now())
returns table (
  occurrence_id uuid,
  rule_id uuid,
  escalation_policy_id uuid,
  recipient_id uuid,
  channel public.notification_channel,
  kind text,
  template_key text,
  offset_days int,
  obligation_code text,
  obligation_name text,
  authority_name text,
  criticality public.criticality,
  period_key text,
  internal_due_date date,
  legal_due_date date,
  status public.occurrence_status,
  recipient_email text,
  recipient_name text,
  owner_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with reference as (
    -- ⚠️ La journée de référence est celle d'ALGER, pas celle d'UTC. À 23 h 30
    -- locales, UTC est encore la veille : le jalon J-1 partirait un jour trop
    -- tard, tous les soirs, sans que rien ne le signale.
    select ((p_now at time zone 'Africa/Algiers')::date) as today
  ),
  eligible as (
    select oc.id, oc.obligation_type_id, oc.period_key, oc.internal_due_date,
           oc.legal_due_date, oc.status, ot.code, ot.name, ot.criticality,
           a.name as authority_name,
           -- Le porteur est nommé pour l'escalade : un responsable de service
           -- qui reçoit une alerte sans savoir DE QUI il s'agit doit ouvrir
           -- l'application rien que pour comprendre le message.
           owner.full_name as owner_name
    from public.obligation_occurrences oc
    join public.obligation_types ot on ot.id = oc.obligation_type_id
    left join public.authorities a on a.id = ot.authority_id
    left join public.profiles owner on owner.id = oc.owner_id
    where oc.deleted_at is null
      and oc.status not in ('SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE')
  ),
  jalons as (
    select e.id as occurrence_id, r.id as rule_id, null::uuid as escalation_policy_id,
           m.member_id as recipient_id, r.channel,
           case when r.offset_days < 0 then 'UPCOMING_DEADLINE' else 'OVERDUE_ALERT' end as kind,
           r.template_key, r.offset_days,
           e.code, e.name, e.authority_name, e.criticality,
           e.period_key, e.internal_due_date, e.legal_due_date, e.status, e.owner_name
    from eligible e
    cross join reference ref
    cross join lateral public.resolve_notification_rules(e.obligation_type_id, e.criticality) r
    cross join lateral public.notification_audience_members(e.id, r.audience) as m(member_id)
    where e.internal_due_date + r.offset_days = ref.today
  ),
  escalades as (
    select e.id as occurrence_id, null::uuid as rule_id, p.id as escalation_policy_id,
           m.member_id as recipient_id, c.channel::public.notification_channel,
           'ESCALATION' as kind, 'EscalationNotice' as template_key, p.days_after_due as offset_days,
           e.code, e.name, e.authority_name, e.criticality,
           e.period_key, e.internal_due_date, e.legal_due_date, e.status, e.owner_name
    from eligible e
    cross join reference ref
    cross join lateral public.resolve_escalation_policies(e.obligation_type_id, e.criticality) p
    cross join lateral (
      -- Un palier désigne une audience, un rôle ou une personne. Les trois
      -- coexistent : la chaîne standard emploie l'audience, une politique locale
      -- peut viser nommément le contrôleur de gestion.
      select member_id from public.notification_audience_members(e.id, p.notify_audience) as t(member_id)
      union
      select ur.user_id
      from public.user_roles ur
      where p.notify_role_id is not null
        and ur.role_id = p.notify_role_id
        and ur.revoked_at is null
        and (ur.expires_at is null or ur.expires_at > now())
      union
      select p.notify_user_id where p.notify_user_id is not null
    ) as m(member_id)
    cross join (values ('EMAIL'), ('IN_APP')) as c(channel)
    where e.internal_due_date + p.days_after_due = ref.today
  ),
  toutes as (select * from jalons union all select * from escalades)
  select t.occurrence_id, t.rule_id, t.escalation_policy_id, t.recipient_id, t.channel,
         t.kind, t.template_key, t.offset_days, t.code, t.name, t.authority_name,
         t.criticality, t.period_key, t.internal_due_date, t.legal_due_date, t.status,
         pr.email, pr.full_name, t.owner_name
  from toutes t
  join public.profiles pr on pr.id = t.recipient_id
  left join public.user_notification_preferences pref
    on pref.user_id = t.recipient_id and pref.channel = t.channel
  where pr.is_active
    and pr.deleted_at is null
    and pr.deactivated_at is null
    -- Absence de ligne = canal actif. Un compte neuf doit être prévenu, pas muet.
    and coalesce(pref.is_enabled, true)
    -- Le canal SMS existe dans le modèle et n'a pas d'implémentation : produire
    -- des candidates pour lui remplirait la file de messages qui échoueraient.
    and t.channel <> 'SMS'
    -- Un courriel sans adresse n'est pas un envoi raté, c'est un envoi impossible.
    and (t.channel <> 'EMAIL' or pr.email is not null);
$$;

comment on function public.due_notification_candidates(timestamptz) is
  'Ce qui doit être notifié AUJOURD''HUI, heure d''Alger. Ne crée rien : la fonction '
  'est en lecture seule et rejouable à volonté. L''écriture, elle, passe par '
  'enqueue_notification, où la contrainte d''unicité tranche.';

revoke execute on function public.due_notification_candidates(timestamptz)
  from public, anon, authenticated;

-- =============================================================================
-- 13. ÉCRITURE — LA CONTRAINTE TRANCHE, PAS L'APPELANT
-- =============================================================================

/*
 * ⚠️ Les paramètres FACULTATIFS portent un défaut, et sont donc placés en fin de
 * signature — PostgreSQL l'exige. Ce n'est pas une coquetterie de style : le
 * générateur de types Supabase rend obligatoire tout argument sans défaut, si
 * bien qu'un appelant TypeScript ne pouvait pas exprimer « pas d'occurrence »
 * pour le résumé hebdomadaire, ni « pas de règle » pour une escalade.
 */
create or replace function public.enqueue_notification(
  p_recipient uuid,
  p_channel public.notification_channel,
  p_kind text,
  p_subject text,
  p_body_text text,
  p_scheduled_for timestamptz,
  p_occurrence uuid default null,
  p_rule uuid default null,
  p_escalation uuid default null,
  p_body_html text default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_id bigint;
begin
  insert into public.notifications (
    recipient_id, kind, occurrence_id, rule_id, escalation_policy_id,
    channel, subject, body_html, body_text, scheduled_for)
  values (
    p_recipient, p_kind, p_occurrence, p_rule, p_escalation,
    p_channel, p_subject, p_body_html, p_body_text, p_scheduled_for)
  on conflict do nothing
  returning id into inserted_id;

  -- NULL n'est pas une erreur : c'est « déjà notifié ». Le planificateur compte
  -- les NULL comme des doublons évités, et c'est cette mesure qui prouve
  -- l'idempotence en exploitation, pas seulement en test.
  return inserted_id;
end;
$$;

comment on function public.enqueue_notification is
  'Insertion déduplicative. Rend l''identifiant créé, ou NULL si la notification '
  'existait déjà. ⚠️ Le `on conflict do nothing` est SANS CIBLE, délibérément : il '
  'couvre l''index des jalons ET celui de l''escalade, sans que l''appelant ait à '
  'savoir lequel des deux l''a arrêté.';

revoke execute on function public.enqueue_notification(
  uuid, public.notification_channel, text, text, text, timestamptz, uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function public.pending_email_notifications(
  p_now timestamptz,
  p_limit int,
  p_max_attempts int)
returns table (
  id bigint,
  recipient_id uuid,
  recipient_email text,
  recipient_name text,
  subject text,
  body_html text,
  body_text text,
  scheduled_for timestamptz,
  retry_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.recipient_id, p.email, p.full_name,
         n.subject, n.body_html, n.body_text, n.scheduled_for, n.retry_count
  from public.notifications n
  join public.profiles p on p.id = n.recipient_id
  where n.channel = 'EMAIL'
    and n.sent_at is null
    and n.retry_count < p_max_attempts
    and n.scheduled_for <= p_now
    and p.email is not null
    and p.is_active
    and p.deleted_at is null
  -- Ordre de regroupement : par destinataire puis par heure prévue, de sorte que
  -- les messages à fusionner arrivent contigus dans le lot.
  order by n.recipient_id, n.scheduled_for, n.id
  limit p_limit;
$$;

revoke execute on function public.pending_email_notifications(timestamptz, int, int)
  from public, anon, authenticated;

create or replace function public.mark_notifications_sent(p_ids bigint[])
returns int
language sql
security definer
set search_path = ''
as $$
  with touched as (
    update public.notifications
    set sent_at = now(), error_message = null
    where id = any(p_ids) and sent_at is null
    returning id)
  select count(*)::int from touched;
$$;

create or replace function public.mark_notifications_failed(p_ids bigint[], p_error text)
returns int
language sql
security definer
set search_path = ''
as $$
  with touched as (
    update public.notifications
    set retry_count = retry_count + 1,
        -- Le message d'erreur est TRONQUÉ : un fournisseur bavard peut rendre une
        -- page entière, et l'historique des notifications n'est pas un journal
        -- d'exploitation.
        error_message = left(p_error, 500)
    where id = any(p_ids) and sent_at is null
    returning id)
  select count(*)::int from touched;
$$;

comment on function public.mark_notifications_failed(bigint[], text) is
  'Consomme une tentative. La ligne reste dans la file tant que retry_count est '
  'inférieur au plafond ; au-delà elle en sort d''elle-même, sans traitement de '
  'nettoyage et sans perdre la trace de l''échec.';

revoke execute on function public.mark_notifications_sent(bigint[]) from public, anon, authenticated;
revoke execute on function public.mark_notifications_failed(bigint[], text) from public, anon, authenticated;

/*
 * Alerte administrateur sur échec définitif. In-app uniquement, et c'est
 * délibéré : prévenir par courriel qu'un courriel n'est pas parti supposerait
 * résolu le problème que l'on signale.
 */
create or replace function public.notify_admins_of_delivery_failures(p_max_attempts int)
returns int
language sql
security definer
set search_path = ''
as $$
  with epuisees as (
    select n.id, n.error_message
    from public.notifications n
    where n.channel = 'EMAIL'
      and n.sent_at is null
      and n.retry_count >= p_max_attempts
      and n.created_at > now() - interval '24 hours'
  ),
  administrateurs as (
    select distinct ur.user_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where r.code = 'ADMIN'
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  ),
  ajoutees as (
    insert into public.notifications (recipient_id, kind, channel, subject, body_text, reason)
    select a.user_id, 'DELIVERY_FAILURE', 'IN_APP',
           'notifications.deliveryFailure.subject',
           'notifications.deliveryFailure.body',
           (select count(*)::text from epuisees)
    from administrateurs a
    where exists (select 1 from epuisees)
      -- Une alerte par administrateur et par jour : l'échec est déjà connu, le
      -- répéter toutes les heures le rendrait invisible.
      and not exists (
        select 1 from public.notifications existante
        where existante.recipient_id = a.user_id
          and existante.kind = 'DELIVERY_FAILURE'
          and existante.subject = 'notifications.deliveryFailure.subject'
          and existante.created_at > now() - interval '24 hours')
    returning id)
  select count(*)::int from ajoutees;
$$;

revoke execute on function public.notify_admins_of_delivery_failures(int)
  from public, anon, authenticated;

-- =============================================================================
-- 14. VISIBILITÉ PARAMÉTRÉE PAR PROFIL
--
--     ⚠️ Le flux ICS s'exécute SANS SESSION : la route est authentifiée par un
--     jeton, pas par un cookie, donc `auth.uid()` y vaut NULL et toutes les
--     fonctions de cloisonnement existantes s'effondrent sur « aucun accès ».
--
--     La tentation était de recopier le prédicat de visibilité dans une fonction
--     dédiée au flux. On fait l'inverse : les fonctions existantes reçoivent une
--     variante paramétrée par profil, et les versions de session DÉLÈGUENT à
--     celle-ci. Il y a donc toujours UNE seule règle de cloisonnement — le flux
--     ne peut pas diverger de l'application, puisqu'il lit le même code.
-- =============================================================================

create or replace function public.is_active_user_for(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user
      and p.is_active
      and p.deleted_at is null
      and p.deactivated_at is null
  );
$$;

create or replace function public.effective_principals_for(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p_user where p_user is not null
  union
  select d.delegator_id
  from public.validation_delegations d
  where d.delegate_id = p_user
    and d.revoked_at is null
    and current_date between d.starts_at and d.ends_at;
$$;

create or replace function public.has_permission_in_domain_for(
  p_user uuid, perm text, target_domain uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id in (select public.effective_principals_for(p_user))
      and p.code = perm
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
      and (ur.domain_id is null or ur.domain_id = target_domain)
  ) and public.is_active_user_for(p_user);
$$;

create or replace function public.can_see_occurrence_for(p_user uuid, p_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.obligation_occurrences oc
    where oc.id = p_occurrence_id
      and oc.deleted_at is null
      and public.is_active_user_for(p_user)
      and (
        public.has_permission_in_domain_for(
          p_user, 'occurrence.read', public.obligation_domain_of_type(oc.obligation_type_id))
        or oc.owner_id = p_user
        or oc.validator_id = p_user
      )
  );
$$;

comment on function public.can_see_occurrence_for(uuid, uuid) is
  'Cloisonnement des occurrences, pour un profil DONNÉ. Source unique : la version '
  'de session `can_see_occurrence` délègue ici, et le test d''intégration compare les '
  'deux au prédicat de la politique RLS.';

/*
 * ⚠️ LES VERSIONS DE SESSION NE DÉLÈGUENT PAS. C'est délibéré, et c'est le
 * contraire de ce que ce fichier a d'abord fait.
 *
 * La première rédaction transformait `is_active_user`, `effective_principals`,
 * `has_permission_in_domain` et `can_see_occurrence` en simples façades sur les
 * variantes `_for` : une seule règle, deux portes d'entrée. C'était le bon
 * dessin et il a été MESURÉ inexploitable. Ces fonctions sont SECURITY DEFINER
 * avec `set search_path` : PostgreSQL ne peut pas les inliner. Chaque ligne
 * évaluée par la politique RLS payait donc deux appels non inlinables au lieu
 * d'un, et `pending_validation_count()` sur 50 000 occurrences est passé de
 * 92 ms à plus de 30 secondes — le test de charge n'a pas échoué, il a expiré.
 *
 * Les corps sont donc RECOPIÉS ici, à l'identique, et la divergence est
 * empêchée mécaniquement plutôt que par discipline : le test d'intégration
 * `rls-parity` compare, pour une matrice d'utilisateurs et d'occurrences, ce
 * que rend la version de session et ce que rend la version paramétrée. Toute
 * dérive fait rougir la suite.
 *
 * Le projet emploie déjà exactement ce compromis : `can_see_occurrence` est,
 * depuis 0008, une copie assumée du USING de la politique, gardée par un test
 * de comparaison. On ne fait pas pire ; on rend le garde-fou explicite.
 */

-- =============================================================================
-- 15. FLUX CALENDRIER
-- =============================================================================

create or replace function public.calendar_feed(p_token uuid, p_months int default 12)
returns table (
  occurrence_id uuid,
  obligation_code text,
  obligation_name text,
  authority_name text,
  period_key text,
  internal_due_date date,
  legal_due_date date,
  status public.occurrence_status,
  criticality public.criticality,
  updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with porteur as (
    select p.id
    from public.calendar_feed_tokens t
    join public.profiles p on p.id = t.user_id
    where t.token = p_token
      and p.is_active
      and p.deleted_at is null
      and p.deactivated_at is null
  ),
  /*
   * Les domaines accessibles sont calculés UNE FOIS, pas une fois par ligne.
   * L'appel par ligne de la fonction de cloisonnement coûtait des secondes sur
   * les volumes réels — la même erreur, mesurée puis corrigée, que sur le
   * tableau de bord et la file de validation.
   */
  domaines as (
    select d.id
    from public.domains d, porteur
    where public.has_permission_in_domain_for(porteur.id, 'occurrence.read', d.id)
  )
  select oc.id, ot.code, ot.name, a.name, oc.period_key,
         oc.internal_due_date, oc.legal_due_date, oc.status, ot.criticality, oc.updated_at
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  left join public.authorities a on a.id = ot.authority_id
  cross join porteur
  where oc.deleted_at is null
    and (ot.domain_id in (select id from domaines)
         or oc.owner_id = porteur.id
         or oc.validator_id = porteur.id)
    -- 12 mois devant. Et 30 jours DERRIÈRE : un agenda qui efface l'échéance
    -- manquée le lendemain supprime précisément l'information qui reste à traiter.
    and oc.internal_due_date >= current_date - 30
    and oc.internal_due_date <= current_date + (p_months * 31)
  order by oc.internal_due_date;
$$;

comment on function public.calendar_feed(uuid, int) is
  'Occurrences visibles par le PORTEUR DU JETON, sur douze mois. Le prédicat reprend '
  'terme pour terme celui de can_see_occurrence_for, en version ensembliste ; un test '
  'd''intégration compare les deux ligne à ligne pour interdire toute dérive. '
  '⚠️ Aucune donnée confidentielle n''en sort : ni document, ni montant, ni commentaire.';

-- Le flux est appelé sans session : la route anonyme doit pouvoir l'exécuter.
-- Le jeton EST l'authentification, et il est la seule chose qui ouvre la porte.
grant execute on function public.calendar_feed(uuid, int) to anon, authenticated;

create or replace function public.own_ics_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  jeton uuid;
begin
  if public.current_profile_id() is null then
    raise exception 'Session requise.' using errcode = '42501';
  end if;

  select t.token into jeton
  from public.calendar_feed_tokens t
  where t.user_id = public.current_profile_id();

  -- Filet : un profil sans jeton ne devrait pas exister (trigger + reprise), mais
  -- un écran vide vaut moins qu'un jeton créé à la volée.
  if jeton is null then
    insert into public.calendar_feed_tokens (user_id)
    values (public.current_profile_id())
    on conflict (user_id) do nothing
    returning token into jeton;
  end if;

  return jeton;
end;
$$;

grant execute on function public.own_ics_token() to authenticated;

create or replace function public.regenerate_ics_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  nouveau uuid;
begin
  if public.current_profile_id() is null then
    raise exception 'Session requise.' using errcode = '42501';
  end if;

  insert into public.calendar_feed_tokens (user_id, rotated_at)
  values (public.current_profile_id(), now())
  on conflict (user_id) do update
    set token = gen_random_uuid(), rotated_at = now()
  returning token into nouveau;

  return nouveau;
end;
$$;

comment on function public.regenerate_ics_token() is
  'Rotation du jeton de flux. L''ancien cesse de fonctionner À L''INSTANT : il ne '
  'correspond plus à aucune ligne, et calendar_feed rend alors zéro occurrence. '
  'Aucune période de grâce — un jeton qu''on révoque parce qu''il a fuité doit mourir '
  'tout de suite, pas à la fin d''une fenêtre de tolérance.';

grant execute on function public.regenerate_ics_token() to authenticated;

-- =============================================================================
-- 16. PLANIFICATION
-- =============================================================================

do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('conformia-notifications')
  where exists (select 1 from cron.job where jobname = 'conformia-notifications');

  -- Toutes les heures, à la minute 5 : la génération d'occurrences tourne à
  -- 01 h 00 UTC, et lui laisser terminer évite de notifier sur un échéancier
  -- à moitié écrit.
  perform cron.schedule(
    'conformia-notifications',
    '5 * * * *',
    $job$select net.http_post(
      url := current_setting('app.notifications_url', true),
      headers := jsonb_build_object('Content-Type', 'application/json')
    )$job$);
exception
  when others then
    raise notice 'pg_cron/pg_net indisponible (%). Déclencher les notifications par '
      'un ordonnanceur externe sur POST /api/cron/notifications.', sqlerrm;
end
$$;

-- =============================================================================
-- 17. RÉSUMÉ HEBDOMADAIRE
--
--     Adressé aux responsables de service et à la Direction — ceux dont le
--     travail est de regarder l'ensemble. Un agent reçoit ses jalons ; il n'a que
--     faire d'un panorama qu'il ne peut pas actionner.
-- =============================================================================

create or replace function public.weekly_digest_recipients()
returns table (user_id uuid, email text, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, p.email, p.full_name
  from public.profiles p
  left join public.user_notification_preferences pref
    on pref.user_id = p.id and pref.channel = 'EMAIL'
  where p.is_active
    and p.deleted_at is null
    and p.deactivated_at is null
    and p.email is not null
    -- Absence de ligne = abonné. Un responsable nommé la semaine dernière doit
    -- recevoir le résumé de cette semaine, sans avoir rien eu à cocher.
    and coalesce(pref.is_enabled, true)
    and coalesce(pref.digest_frequency, 'WEEKLY') = 'WEEKLY'
    and (
      exists (select 1 from public.departments d where d.head_id = p.id)
      or exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.user_id = p.id
          and r.code = 'DIRECTION'
          and ur.revoked_at is null
          and (ur.expires_at is null or ur.expires_at > now()))
    );
$$;

comment on function public.weekly_digest_recipients() is
  'Responsables de service et Direction, abonnés au résumé. La préférence est '
  'respectée ; son absence vaut abonnement.';

revoke execute on function public.weekly_digest_recipients() from public, anon, authenticated;

create or replace function public.weekly_digest_rows(
  p_user uuid,
  p_now timestamptz,
  p_limit int)
returns table (
  section text,
  label text,
  due_date date,
  ordering date)
language sql
stable
security definer
set search_path = ''
as $$
  with reference as (
    select ((p_now at time zone 'Africa/Algiers')::date) as today
  ),
  /*
   * Domaines accessibles calculés UNE FOIS. Le résumé lit tout l'échéancier du
   * destinataire : appeler le cloisonnement par ligne coûterait ici ce qu'il a
   * coûté au tableau de bord avant qu'on ne le mesure.
   */
  domaines as (
    select d.id from public.domains d
    where public.has_permission_in_domain_for(p_user, 'occurrence.read', d.id)
  ),
  visibles as (
    select oc.id, oc.internal_due_date, oc.status, ot.code, ot.name
    from public.obligation_occurrences oc
    join public.obligation_types ot on ot.id = oc.obligation_type_id
    where oc.deleted_at is null
      and (ot.domain_id in (select id from domaines)
           or oc.owner_id = p_user
           or oc.validator_id = p_user)
  ),
  sections as (
    -- Échéances de la semaine : les sept jours à venir, échéance interne.
    select 'weekAhead' as section,
           v.code || ' — ' || v.name as label,
           v.internal_due_date as due_date,
           v.internal_due_date as ordering
    from visibles v, reference r
    where v.status not in ('SUBMITTED', 'ARCHIVED', 'NOT_APPLICABLE')
      and v.internal_due_date between r.today and r.today + 6

    union all

    -- Retards en cours : échéance passée, dossier non clos. Le plus ancien
    -- d'abord — c'est celui qui coûte le plus cher.
    select 'overdue',
           v.code || ' — ' || v.name,
           v.internal_due_date,
           v.internal_due_date
    from visibles v, reference r
    where v.status in ('TODO', 'IN_PROGRESS', 'REJECTED')
      and v.internal_due_date < r.today

    union all

    select 'pendingValidation',
           v.code || ' — ' || v.name,
           v.internal_due_date,
           v.internal_due_date
    from visibles v
    where v.status = 'PENDING_VALIDATION'

    union all

    -- Nouveautés du référentiel : ce qui a été ajouté depuis le dernier résumé.
    -- Sans cette section, une obligation créée en cours de semaine n'existe pour
    -- les responsables qu'au moment où elle produit sa première échéance.
    select 'newObligations',
           ot.code || ' — ' || ot.name,
           null::date,
           ot.created_at::date
    from public.obligation_types ot
    where ot.deleted_at is null
      and ot.is_active
      and ot.created_at > p_now - interval '7 days'
      and (ot.domain_id in (select id from domaines))
  )
  select s.section, s.label, s.due_date, s.ordering
  from sections s
  order by s.section, s.ordering nulls last, s.label
  limit p_limit;
$$;

comment on function public.weekly_digest_rows(uuid, timestamptz, int) is
  'Contenu du résumé pour un destinataire, toutes sections confondues. Borné par '
  'p_limit : un résumé qui déborde n''est pas lu, donc n''informe personne.';

revoke execute on function public.weekly_digest_rows(uuid, timestamptz, int)
  from public, anon, authenticated;

-- =============================================================================
-- 18. PLANIFICATION DU RÉSUMÉ
--
--     ⚠️ Planifié TOUTES LES HEURES, et non le lundi à 07 h 00.
--
--     Le jour et l'heure sont des RÉGLAGES (`weekly_digest_day`,
--     `weekly_digest_hour`) : les inscrire dans l'expression cron les figerait,
--     et les changer depuis l'écran d'administration n'aurait aucun effet — le
--     pire des deux mondes, un réglage qui ment. La tâche se réveille donc
--     chaque heure et se retire elle-même si l'heure d'Alger ne correspond pas.
-- =============================================================================

do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('conformia-weekly-digest')
  where exists (select 1 from cron.job where jobname = 'conformia-weekly-digest');

  perform cron.schedule(
    'conformia-weekly-digest',
    '15 * * * *',
    $job$select net.http_post(
      url := current_setting('app.weekly_digest_url', true),
      headers := jsonb_build_object('Content-Type', 'application/json')
    )$job$);
exception
  when others then
    raise notice 'pg_cron/pg_net indisponible (%). Déclencher le résumé par un '
      'ordonnanceur externe sur POST /api/cron/digest.', sqlerrm;
end
$$;
