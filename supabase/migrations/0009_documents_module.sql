-- =============================================================================
-- 0009 — MODULE DOCUMENTS
--
-- Trois changements de fond, et rien d'autre :
--
--   1. LE FICHIER NE TRANSITE PLUS PAR LE SERVEUR APPLICATIF.
--      Le dépôt devient une poignée de main en deux temps : le serveur émet un
--      BILLET (`document_upload_tickets`) qui fixe le chemin, la version et le
--      quota ; le navigateur envoie les octets DIRECTEMENT au stockage ; le
--      serveur confirme et n'inscrit la ligne `documents` qu'ensuite.
--
--      Conséquence recherchée : un fichier de 25 Mo ne traverse plus la mémoire
--      d'un processus Next.js. Conséquence subie, et traitée ici : entre
--      l'émission et la confirmation, il existe un objet dans le bucket que
--      personne ne peut lire — la politique de lecture de storage.objects exige
--      une ligne `documents` portant ce chemin, et cette ligne n'existe pas
--      encore. C'est l'état sûr : un fichier orphelin est invisible, une ligne
--      orpheline serait une pièce fantôme dans un dossier de conformité.
--
--   2. L'INTÉGRITÉ DEVIENT UN ÉTAT, PAS UNE DATE.
--      `documents.sha256` est désormais calculée PAR LE CLIENT (c'est lui qui
--      tient les octets). Elle ne prouve donc rien tant qu'un contrôle serveur
--      ne l'a pas confirmée. `integrity_status` dit lequel des deux cas on est :
--      PENDING tant que nul ne l'a recalculée, VERIFIED après confrontation,
--      MISMATCH si le stockage a divergé. Afficher « intègre » sur une empreinte
--      jamais vérifiée serait un mensonge d'interface.
--
--   3. LA JOURNALISATION D'ACCÈS ALIMENTE AUSSI `audit_log`.
--      0003 n'écrivait que dans `document_access_log`. Les deux journaux
--      répondent à des questions différentes — « qui a ouvert cette pièce » et
--      « que s'est-il passé sur ce dossier » — et la seconde doit inclure la
--      consultation d'une déclaration fiscale.
--
-- Ce qui n'est PAS ici, délibérément : aucune suppression automatique, aucune
-- politique DELETE sur storage.objects pour `authenticated`, aucun filigrane.
-- =============================================================================

-- =============================================================================
-- 1. ASSAINISSEMENT DE CHEMIN, CÔTÉ BASE
-- =============================================================================

create or replace function public.storage_path_segment(p_value text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(
    nullif(trim(both '-' from lower(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]+', '-', 'g'))), ''),
    'na');
$fn$;

comment on function public.storage_path_segment(text) is
  'Réduit un segment de chemin à [a-z0-9-]. Employée UNIQUEMENT sur des valeurs '
  'issues de la base (code entité, code domaine, code obligation, clé de période) : '
  'le pendant TypeScript `slugify` traite en plus les diacritiques, superflus ici '
  'puisque ces codes sont contraints à l''ASCII par leurs propres contraintes. '
  '⚠️ C''est cette fonction, et non le client, qui compose le chemin : un « ../ » '
  'ne peut pas atteindre le stockage parce qu''aucune chaîne du navigateur n''entre '
  'jamais dans un segment.';

-- =============================================================================
-- 2. BILLETS DE DÉPÔT
-- =============================================================================

create table public.document_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete restrict,
  occurrence_id uuid not null
    references public.obligation_occurrences (id) on delete restrict,
  checklist_item_id uuid
    references public.occurrence_checklist_items (id) on delete set null,

  bucket text not null default 'compliance-documents',
  storage_path text not null unique,

  original_filename text not null,
  normalized_filename text not null,
  declared_mime_type text not null,
  declared_size_bytes bigint not null
    check (declared_size_bytes > 0 and declared_size_bytes <= 26214400),
  document_kind text check (document_kind in
    ('JUSTIFICATIF', 'PREUVE_DEPOT', 'ANNEXE', 'CORRESPONDANCE')),

  version int not null check (version > 0),
  supersedes_id uuid references public.documents (id) on delete restrict,

  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  consumed_at timestamptz,
  consumed_document_id uuid references public.documents (id) on delete restrict,
  rejected_at timestamptz,
  rejection_reason text,

  constraint upload_tickets_single_outcome
    check (num_nonnulls(consumed_at, rejected_at) <= 1),
  constraint upload_tickets_consumption_traced
    check (consumed_at is null or consumed_document_id is not null),
  constraint upload_tickets_rejection_traced
    check (rejected_at is null or rejection_reason is not null)
);

comment on table public.document_upload_tickets is
  'Contrat entre le serveur et le navigateur, le temps d''un envoi direct vers le '
  'stockage. Le billet FIXE ce que le client ne doit pas choisir : le chemin, le '
  'numéro de version, la pièce visée, le plafond de taille. À la confirmation, le '
  'serveur ne relit que le billet — la seconde requête du navigateur ne peut donc '
  'pas déplacer le dépôt vers un autre dossier ni changer sa nature. '
  '⚠️ Un billet REJETÉ est une trace de sécurité : il dit que quelqu''un a envoyé '
  'un fichier dont les octets démentaient le type annoncé.';
comment on column public.document_upload_tickets.storage_path is
  'Composé ICI, jamais reçu du client : préfixe déduit de l''occurrence, feuille '
  'préfixée par l''identifiant du billet. Deux billets ne peuvent pas viser le même '
  'objet, et une confirmation ne peut pas réutiliser le chemin d''une autre.';
comment on column public.document_upload_tickets.version is
  'Réservée dès l''émission. Sans cette réservation, deux envois simultanés sur la '
  'même pièce calculeraient tous deux « v2 » et le second violerait l''unicité '
  '(occurrence_id, normalized_filename, version) après un envoi déjà payé.';
comment on column public.document_upload_tickets.expires_at is
  'Au-delà, la confirmation est refusée. L''objet éventuellement déposé reste '
  'illisible faute de ligne `documents`, et sera balayé par la tâche de ménage.';

create index document_upload_tickets_occurrence_idx
  on public.document_upload_tickets (occurrence_id)
  where consumed_at is null and rejected_at is null;
create index document_upload_tickets_creator_idx
  on public.document_upload_tickets (created_by, created_at desc);
-- Balayage de la tâche de ménage : billets ouverts et périmés.
create index document_upload_tickets_expiry_idx
  on public.document_upload_tickets (expires_at)
  where consumed_at is null;

create trigger trg_audit
  after insert or update or delete on public.document_upload_tickets
  for each row execute function public.audit_trigger();

alter table public.document_upload_tickets enable row level security;

-- Écriture EXCLUSIVEMENT par les fonctions ci-dessous. Aucune politique INSERT,
-- UPDATE ni DELETE n'existe : un billet forgé à la main permettrait de choisir
-- son propre chemin de stockage, ce qui est précisément ce que le billet empêche.
revoke insert, update, delete on public.document_upload_tickets
  from public, anon, authenticated, service_role;
grant select on public.document_upload_tickets to authenticated;

create policy document_upload_tickets_select on public.document_upload_tickets
  for select to authenticated
  using (
    public.is_active_user()
    and (created_by = public.current_profile_id() or public.has_permission('audit.read'))
  );
comment on policy document_upload_tickets_select on public.document_upload_tickets is
  'On voit ses propres billets — l''interface doit pouvoir reprendre un envoi '
  'interrompu — et les auditeurs voient tout, y compris les tentatives rejetées.';

-- -----------------------------------------------------------------------------
-- Émission
-- -----------------------------------------------------------------------------

-- ⚠️ Les paramètres pouvant valoir NULL sont placés EN DERNIER, avec un défaut.
-- Ce n'est pas de l'esthétique : le générateur de types de Supabase déclare
-- obligatoire tout paramètre sans défaut, et le client TypeScript refuserait
-- alors de lui passer `null` — pourtant licite ici (pièce libre, sans extension).
-- La signature suit donc ce que le typage sait exprimer.
create or replace function public.create_document_upload_ticket(
  p_occurrence_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_slug text,
  p_name_stem text,
  p_checklist_item_id uuid default null,
  p_document_kind text default null,
  p_extension text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  occ record;
  bucket_row record;
  ttl_seconds int;
  used_bytes bigint;
  quota_bytes bigint;
  previous_version int;
  reserved_version int;
  next_version int;
  supersedes uuid;
  ticket_id uuid := gen_random_uuid();
  composed_path text;
  composed_name text;
begin
  -- ── Forme des fragments venus du serveur applicatif ───────────────────────
  -- Ils sont produits par `src/lib/files.ts`, mais la base ne le suppose pas :
  -- cette fonction est appelable par toute session authentifiée.
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{0,59}$' then
    return jsonb_build_object('status', 'INVALID_NAME');
  end if;
  if p_extension is not null and p_extension !~ '^[a-z0-9]{1,8}$' then
    return jsonb_build_object('status', 'INVALID_NAME');
  end if;
  if p_name_stem is null or p_name_stem !~ '^[A-Za-z0-9_-]{1,180}$' then
    return jsonb_build_object('status', 'INVALID_NAME');
  end if;
  if p_original_filename is null or length(p_original_filename) = 0
     or length(p_original_filename) > 400 then
    return jsonb_build_object('status', 'INVALID_NAME');
  end if;

  -- ── Occurrence, et droit de la voir ───────────────────────────────────────
  -- SECURITY DEFINER neutralise la RLS : la visibilité est revérifiée
  -- explicitement, avec la MÊME fonction que la politique de lecture.
  if not public.can_see_occurrence(p_occurrence_id) then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  select oc.id, oc.entity_id, oc.period_key, oc.is_locked,
         ot.code as obligation_code,
         e.code as entity_code,
         coalesce(dom.code, 'domaine') as domain_code
    into occ
  from public.obligation_occurrences oc
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  join public.entities e on e.id = oc.entity_id
  left join public.domains dom on dom.id = ot.domain_id
  where oc.id = p_occurrence_id and oc.deleted_at is null;

  if occ.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  if not public.has_permission_in_domain(
       'document.upload', public.obligation_domain_of_occurrence(p_occurrence_id))
  then
    return jsonb_build_object('status', 'DENIED');
  end if;

  -- Un dossier verrouillé n'accepte plus de pièce, ni première ni nouvelle
  -- version. `enforce_occurrence_lock` protège l'occurrence, pas ses pièces.
  if occ.is_locked then
    return jsonb_build_object('status', 'OCCURRENCE_LOCKED');
  end if;

  if p_checklist_item_id is not null and not exists (
    select 1 from public.occurrence_checklist_items ci
    where ci.id = p_checklist_item_id and ci.occurrence_id = p_occurrence_id)
  then
    return jsonb_build_object('status', 'INVALID_CHECKLIST_ITEM');
  end if;

  -- ── Type et taille : la source est le bucket lui-même ─────────────────────
  -- Recopier la liste blanche ici la ferait diverger de celle que le stockage
  -- applique réellement au moment de l'envoi. Une seule liste, un seul endroit.
  select b.allowed_mime_types, b.file_size_limit into bucket_row
  from storage.buckets b where b.id = 'compliance-documents';

  if bucket_row.allowed_mime_types is not null
     and not (lower(coalesce(p_mime_type, '')) = any (bucket_row.allowed_mime_types))
  then
    return jsonb_build_object('status', 'MIME_NOT_ALLOWED');
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 then
    return jsonb_build_object('status', 'EMPTY_FILE');
  end if;
  if p_size_bytes > coalesce(bucket_row.file_size_limit, 26214400) then
    return jsonb_build_object('status', 'TOO_LARGE');
  end if;

  -- ── Quota du dossier ──────────────────────────────────────────────────────
  -- ⚠️ Les billets encore ouverts sont comptés avec les pièces déjà déposées.
  -- Sans cela, dix envois simultanés de 25 Mo passent tous le contrôle des
  -- 200 Mo, et le dépassement n'est constaté qu'une fois les octets écrits.
  select coalesce(sum(d.size_bytes), 0) into used_bytes
  from public.documents d
  where d.occurrence_id = p_occurrence_id and d.deleted_at is null;

  used_bytes := used_bytes + coalesce((
    select sum(t.declared_size_bytes)
    from public.document_upload_tickets t
    where t.occurrence_id = p_occurrence_id
      and t.consumed_at is null and t.rejected_at is null and t.expires_at > now()
  ), 0);

  select coalesce((s.value)::bigint, 209715200) into quota_bytes
  from public.app_settings s where s.key = 'occurrence_total_bytes_limit';
  quota_bytes := coalesce(quota_bytes, 209715200);

  if used_bytes + p_size_bytes > quota_bytes then
    return jsonb_build_object('status', 'QUOTA_EXCEEDED',
      'used_bytes', used_bytes, 'quota_bytes', quota_bytes);
  end if;

  -- ── Version ───────────────────────────────────────────────────────────────
  -- On ne remplace jamais en place : la version suivante se déduit de tout ce
  -- qui existe, pièces retirées comprises. Repartir à v1 après un retrait
  -- ferait réapparaître un nom déjà employé.
  select d.version, case when d.deleted_at is null then d.id else null end
    into previous_version, supersedes
  from public.documents d
  where d.occurrence_id = p_occurrence_id
    and d.checklist_item_id is not distinct from p_checklist_item_id
  order by d.version desc
  limit 1;

  select max(t.version) into reserved_version
  from public.document_upload_tickets t
  where t.occurrence_id = p_occurrence_id
    and t.checklist_item_id is not distinct from p_checklist_item_id
    and t.consumed_at is null and t.rejected_at is null and t.expires_at > now();

  next_version := greatest(coalesce(previous_version, 0), coalesce(reserved_version, 0)) + 1;

  -- ── Chemin et nom ─────────────────────────────────────────────────────────
  composed_path :=
    public.storage_path_segment(occ.entity_code) || '/' ||
    public.storage_path_segment(occ.domain_code) || '/' ||
    public.storage_path_segment(occ.obligation_code) || '/' ||
    public.storage_path_segment(occ.period_key) || '/' ||
    ticket_id::text || '_' || p_slug ||
    case when p_extension is null then '' else '.' || p_extension end;

  -- Le numéro de version est arrêté ICI : le nom normalisé ne peut donc pas
  -- être composé entièrement côté applicatif. Le serveur fournit la racine
  -- assainie, la base y appose la version.
  composed_name := p_name_stem || '_v' || next_version::text ||
    case when p_extension is null then '' else '.' || p_extension end;

  select coalesce((s.value)::int, 900) into ttl_seconds
  from public.app_settings s where s.key = 'upload_ticket_ttl_seconds';
  ttl_seconds := coalesce(ttl_seconds, 900);

  insert into public.document_upload_tickets (
    id, entity_id, occurrence_id, checklist_item_id, storage_path,
    original_filename, normalized_filename, declared_mime_type, declared_size_bytes,
    document_kind, version, supersedes_id, created_by, expires_at
  )
  values (
    ticket_id, occ.entity_id, p_occurrence_id, p_checklist_item_id, composed_path,
    p_original_filename, composed_name, lower(p_mime_type), p_size_bytes,
    p_document_kind, next_version, supersedes, public.current_profile_id(),
    now() + make_interval(secs => ttl_seconds)
  );

  return jsonb_build_object(
    'status', 'ISSUED',
    'ticket_id', ticket_id,
    'storage_path', composed_path,
    'normalized_filename', composed_name,
    'version', next_version,
    'expires_in_seconds', ttl_seconds);
end;
$fn$;

comment on function public.create_document_upload_ticket(
  uuid, text, text, bigint, text, text, uuid, text, text) is
  'Ouvre un dépôt direct vers le stockage. Vérifie le droit, le verrou, le type, '
  'la taille et le quota AVANT qu''un seul octet ne parte, puis fige le chemin et '
  'la version. Rend un statut, jamais une exception : un refus de quota est une '
  'réponse métier, pas un bug.';

grant execute on function public.create_document_upload_ticket(
  uuid, text, text, bigint, text, text, uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Confirmation
-- -----------------------------------------------------------------------------

create or replace function public.confirm_document_upload(
  p_ticket_id uuid,
  p_sha256 text,
  p_actual_size bigint,
  p_detected_mime_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  ticket record;
  new_document_id uuid := gen_random_uuid();
begin
  select * into ticket
  from public.document_upload_tickets
  where id = p_ticket_id
  for update;

  if ticket.id is null then
    return jsonb_build_object('status', 'TICKET_NOT_FOUND');
  end if;

  -- Un billet appartient à celui qui l'a demandé. Personne ne confirme le dépôt
  -- d'autrui : sinon `uploaded_by` cesserait de désigner l'auteur réel.
  if ticket.created_by is distinct from public.current_profile_id() then
    return jsonb_build_object('status', 'TICKET_NOT_FOUND');
  end if;

  if ticket.consumed_at is not null then
    return jsonb_build_object('status', 'ALREADY_CONSUMED',
      'document_id', ticket.consumed_document_id);
  end if;
  if ticket.rejected_at is not null then
    return jsonb_build_object('status', 'TICKET_REJECTED');
  end if;
  if ticket.expires_at <= now() then
    return jsonb_build_object('status', 'TICKET_EXPIRED');
  end if;

  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'INVALID_HASH');
  end if;

  -- La taille annoncée à l'émission a servi à décider du quota. Si l'objet
  -- réellement stocké en fait une autre, la décision reposait sur une donnée
  -- fausse : on refuse plutôt que d'inscrire une ligne inexacte.
  if p_actual_size is distinct from ticket.declared_size_bytes then
    return jsonb_build_object('status', 'SIZE_MISMATCH',
      'declared', ticket.declared_size_bytes, 'actual', p_actual_size);
  end if;

  -- Le droit est revérifié à la confirmation, pas seulement à l'émission : un
  -- rôle peut avoir été retiré entre les deux.
  if not public.has_permission_in_domain(
       'document.upload', public.obligation_domain_of_occurrence(ticket.occurrence_id))
  then
    return jsonb_build_object('status', 'DENIED');
  end if;

  if exists (select 1 from public.obligation_occurrences oc
             where oc.id = ticket.occurrence_id and oc.is_locked)
  then
    return jsonb_build_object('status', 'OCCURRENCE_LOCKED');
  end if;

  insert into public.documents (
    id, entity_id, occurrence_id, checklist_item_id, bucket, storage_path,
    original_filename, normalized_filename, mime_type, detected_mime_type,
    size_bytes, sha256, version, supersedes_id, document_kind, uploaded_by
  )
  values (
    new_document_id, ticket.entity_id, ticket.occurrence_id, ticket.checklist_item_id,
    ticket.bucket, ticket.storage_path,
    ticket.original_filename, ticket.normalized_filename,
    ticket.declared_mime_type, p_detected_mime_type,
    p_actual_size, p_sha256, ticket.version, ticket.supersedes_id,
    ticket.document_kind, ticket.created_by
  );

  update public.document_upload_tickets
  set consumed_at = now(), consumed_document_id = new_document_id
  where id = p_ticket_id;

  return jsonb_build_object(
    'status', 'CREATED',
    'document_id', new_document_id,
    'version', ticket.version,
    'normalized_filename', ticket.normalized_filename);
end;
$fn$;

comment on function public.confirm_document_upload(uuid, text, bigint, text) is
  'Inscrit la ligne `documents` une fois les octets écrits dans le stockage. '
  'Ne fait confiance QU''AU BILLET pour tout ce qui touche à l''emplacement et à '
  'la nature du dépôt ; du client, elle n''accepte que l''empreinte et la taille '
  'observée, toutes deux recoupées. Le droit et le verrou sont revérifiés : '
  'entre l''émission et la confirmation, le monde a pu changer.';

grant execute on function public.confirm_document_upload(uuid, text, bigint, text)
  to authenticated;

create or replace function public.reject_document_upload_ticket(
  p_ticket_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  affected int;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Motif de rejet obligatoire.' using errcode = '22023';
  end if;

  update public.document_upload_tickets
  set rejected_at = now(), rejection_reason = left(trim(p_reason), 500)
  where id = p_ticket_id
    and created_by = public.current_profile_id()
    and consumed_at is null
    and rejected_at is null;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$fn$;

comment on function public.reject_document_upload_ticket(uuid, text) is
  'Clôt un billet dont le contrôle serveur a démenti le contenu — signature '
  'binaire non conforme, taille divergente. Le billet rejeté est CONSERVÉ : '
  'c''est la trace qu''un fichier suspect a été envoyé, et la tâche de ménage '
  's''en sert pour retrouver l''objet à effacer du bucket.';

grant execute on function public.reject_document_upload_ticket(uuid, text) to authenticated;

-- =============================================================================
-- 3. INTÉGRITÉ
-- =============================================================================

create type public.document_integrity_status as enum (
  'PENDING',   -- empreinte déclarée au dépôt, jamais recalculée côté serveur
  'VERIFIED',  -- recalculée et conforme
  'MISMATCH',  -- recalculée et DIFFÉRENTE : le fichier stocké a changé
  'MISSING'    -- la ligne existe, l'objet a disparu du stockage
);

alter table public.documents
  add column integrity_status public.document_integrity_status not null default 'PENDING';

comment on column public.documents.integrity_status is
  'État de VÉRIFICATION de l''empreinte, à ne pas confondre avec l''empreinte '
  'elle-même. PENDING est l''état normal d''une pièce fraîchement déposée : '
  'l''empreinte a été calculée par le NAVIGATEUR, elle n''engage donc que lui '
  'tant que le contrôle mensuel ne l''a pas confrontée aux octets réellement '
  'stockés. C''est cette nuance que l''interface doit rendre — « intègre » sur '
  'une empreinte jamais recalculée serait faux.';

comment on column public.documents.sha256 is
  'Empreinte SHA-256 des octets déposés, calculée CÔTÉ CLIENT par l''API Web '
  'Crypto — le fichier ne transitant pas par le serveur applicatif, celui-ci ne '
  'peut pas la calculer au dépôt. Elle est donc DÉCLARÉE, et `integrity_status` '
  'dit si elle a été confirmée depuis. Le contrôle mensuel la recalcule à partir '
  'du stockage : un écart signifie soit que le fichier a été altéré, soit que '
  'l''empreinte annoncée était fausse dès l''origine. Les deux méritent une alerte.';

create table public.document_integrity_checks (
  id bigint generated by default as identity primary key,
  run_id uuid not null,
  document_id uuid not null references public.documents (id) on delete restrict,
  expected_sha256 text not null,
  actual_sha256 text,
  observed_size_bytes bigint,
  status public.document_integrity_status not null,
  checked_at timestamptz not null default now(),

  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id) on delete restrict,
  acknowledgement_note text,

  constraint integrity_checks_ack_traced
    check (acknowledged_at is null or (acknowledged_by is not null and acknowledgement_note is not null))
);

comment on table public.document_integrity_checks is
  'Résultats du contrôle d''intégrité. Sert aussi de FILE D''ALERTES : une ligne '
  'MISMATCH ou MISSING non acquittée est une alerte ouverte. Un journal séparé '
  'des alertes dupliquerait l''information et permettrait aux deux de diverger.';
comment on column public.document_integrity_checks.run_id is
  'Identifiant de la passe. Permet de dire « le contrôle du 1er mars a couvert '
  '52 pièces », ce qu''une date seule ne permet pas.';
comment on column public.document_integrity_checks.acknowledged_at is
  'Un écart ne se referme pas tout seul : il est acquitté par un humain, avec une '
  'note. Sans acquittement, l''alerte reste affichée.';

create index document_integrity_checks_document_idx
  on public.document_integrity_checks (document_id, checked_at desc);
create index document_integrity_checks_run_idx
  on public.document_integrity_checks (run_id);
-- Alertes ouvertes : le seul index réellement chaud, l'écran les affiche à chaque visite.
create index document_integrity_checks_open_idx
  on public.document_integrity_checks (checked_at desc)
  where acknowledged_at is null and status in ('MISMATCH', 'MISSING');

create trigger trg_audit
  after insert or update or delete on public.document_integrity_checks
  for each row execute function public.audit_trigger();

-- Append-only, à une exception près : l'acquittement. Le constat, lui, ne se
-- réécrit pas — un contrôle d'intégrité dont on peut corriger le résultat ne
-- contrôle rien.
create or replace function public.enforce_integrity_check_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un résultat de contrôle d''intégrité ne se supprime pas.'
      using errcode = '42501';
  end if;

  if new.run_id is distinct from old.run_id
     or new.document_id is distinct from old.document_id
     or new.expected_sha256 is distinct from old.expected_sha256
     or new.actual_sha256 is distinct from old.actual_sha256
     or new.observed_size_bytes is distinct from old.observed_size_bytes
     or new.status is distinct from old.status
     or new.checked_at is distinct from old.checked_at
  then
    raise exception 'Seul l''acquittement est modifiable sur un contrôle d''intégrité.'
      using errcode = '42501';
  end if;

  if old.acknowledged_at is not null then
    raise exception 'Ce constat est déjà acquitté.' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

create trigger trg_integrity_check_immutable
  before update or delete on public.document_integrity_checks
  for each row execute function public.enforce_integrity_check_immutable();

alter table public.document_integrity_checks enable row level security;

revoke insert, update, delete on public.document_integrity_checks
  from public, anon, authenticated, service_role;
grant select on public.document_integrity_checks to authenticated;

create policy document_integrity_checks_select on public.document_integrity_checks
  for select to authenticated
  using (
    public.is_active_user()
    and (
      public.has_permission('audit.read')
      or exists (select 1 from public.documents d where d.id = document_id)
    )
  );
comment on policy document_integrity_checks_select on public.document_integrity_checks is
  'Même règle que le journal d''accès : les auditeurs voient tout, les autres '
  'voient les constats portant sur les pièces qu''ils peuvent déjà lire.';

-- -----------------------------------------------------------------------------
-- Écriture des constats — réservée à la tâche planifiée
-- -----------------------------------------------------------------------------

create or replace function public.record_document_integrity_check(
  p_run_id uuid,
  p_document_id uuid,
  p_status public.document_integrity_status,
  p_actual_sha256 text default null,
  p_observed_size bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  expected text;
  check_id bigint;
begin
  if p_status = 'PENDING' then
    raise exception 'PENDING n''est pas un résultat de contrôle.' using errcode = '22023';
  end if;

  select d.sha256 into expected from public.documents d where d.id = p_document_id;
  if expected is null then
    raise exception 'Document introuvable.' using errcode = '22023';
  end if;

  insert into public.document_integrity_checks (
    run_id, document_id, expected_sha256, actual_sha256, observed_size_bytes, status)
  values (p_run_id, p_document_id, expected, p_actual_sha256, p_observed_size, p_status)
  returning id into check_id;

  update public.documents
  set integrity_status = p_status, integrity_checked_at = now()
  where id = p_document_id;

  return check_id;
end;
$fn$;

comment on function public.record_document_integrity_check(
  uuid, uuid, public.document_integrity_status, text, bigint) is
  'Consigne un constat et reporte son résultat sur la pièce. `expected_sha256` '
  'est relu EN BASE et non reçu en paramètre : l''appelant ne doit pas pouvoir '
  'choisir la valeur à laquelle il se compare.';

-- Le contrôle tourne dans src/server/jobs/ avec la clé de service — seul endroit
-- où elle est admise (CLAUDE.md §6). Aucune session utilisateur ne l'appelle.
revoke execute on function public.record_document_integrity_check(
  uuid, uuid, public.document_integrity_status, text, bigint) from public, anon, authenticated;

create or replace function public.sample_documents_for_integrity(p_sample_size int)
returns table (
  id uuid,
  bucket text,
  storage_path text,
  sha256 text,
  size_bytes bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select d.id, d.bucket, d.storage_path, d.sha256, d.size_bytes
  from public.documents d
  where d.deleted_at is null
  -- Les moins récemment contrôlées d'abord, puis au hasard : une pièce jamais
  -- vérifiée ne doit pas pouvoir échapper indéfiniment au tirage.
  order by d.integrity_checked_at asc nulls first, random()
  limit greatest(coalesce(p_sample_size, 0), 0);
$fn$;

comment on function public.sample_documents_for_integrity(int) is
  'Échantillon à contrôler. Le tri place en tête les pièces jamais vérifiées : '
  'un tirage purement aléatoire laisserait, sur dix ans, des documents que '
  'personne n''aurait jamais recalculés.';

revoke execute on function public.sample_documents_for_integrity(int)
  from public, anon, authenticated;

create or replace function public.acknowledge_integrity_alert(
  p_check_id bigint,
  p_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  affected int;
begin
  if not public.has_permission('audit.read') then
    raise exception 'Acquittement réservé.' using errcode = '42501';
  end if;
  if p_note is null or length(trim(p_note)) < 10 then
    raise exception 'Une note d''acquittement d''au moins 10 caractères est requise.'
      using errcode = '22023';
  end if;

  update public.document_integrity_checks
  set acknowledged_at = now(),
      acknowledged_by = public.current_profile_id(),
      acknowledgement_note = trim(p_note)
  where id = p_check_id and acknowledged_at is null;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$fn$;

comment on function public.acknowledge_integrity_alert(bigint, text) is
  'Referme une alerte d''intégrité. Note obligatoire : « vu » ne dit pas ce qui a '
  'été fait du fichier divergent.';

grant execute on function public.acknowledge_integrity_alert(bigint, text) to authenticated;

create view public.document_integrity_alerts
  with (security_invoker = true)
  as
  select c.id,
         c.run_id,
         c.document_id,
         c.status,
         c.expected_sha256,
         c.actual_sha256,
         c.checked_at,
         d.original_filename,
         d.normalized_filename,
         d.occurrence_id,
         ot.code as obligation_code,
         oc.period_key
  from public.document_integrity_checks c
  join public.documents d on d.id = c.document_id
  join public.obligation_occurrences oc on oc.id = d.occurrence_id
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  where c.acknowledged_at is null
    and c.status in ('MISMATCH', 'MISSING');

comment on view public.document_integrity_alerts is
  'Alertes d''intégrité ouvertes. security_invoker : n''expose que les pièces que '
  'la politique `documents` laisse déjà voir à l''appelant.';

grant select on public.document_integrity_alerts to authenticated;

-- =============================================================================
-- 4. JOURNALISATION D'ACCÈS — ajout de l'écriture dans audit_log
-- =============================================================================

create or replace function public.log_document_access(
  p_document_id uuid,
  p_action text,
  p_ip inet default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  target record;
begin
  if p_action not in ('SIGNED_URL_ISSUED', 'VIEW', 'DOWNLOAD') then
    raise exception 'Action d''accès inconnue : %.', p_action using errcode = '22023';
  end if;

  select d.occurrence_id, d.entity_id, d.normalized_filename into target
  from public.documents d
  where d.id = p_document_id and d.deleted_at is null;

  if target.occurrence_id is null then
    raise exception 'Document introuvable.' using errcode = '42501';
  end if;

  -- SECURITY DEFINER contourne la RLS : le droit doit donc être revérifié ici,
  -- explicitement. Sans ce contrôle, la fonction deviendrait un oracle permettant
  -- de tester l'existence de n'importe quelle pièce.
  if not public.has_permission_in_domain(
       'document.read', public.obligation_domain_of_occurrence(target.occurrence_id))
  then
    raise exception 'Accès refusé à ce document.' using errcode = '42501';
  end if;

  insert into public.document_access_log (document_id, actor_id, action, ip_address, user_agent)
  values (p_document_id, auth.uid(), p_action, p_ip, p_user_agent);

  -- Second journal, question différente. `document_access_log` répond à « qui a
  -- ouvert cette pièce » ; `audit_log` répond à « que s'est-il passé sur ce
  -- dossier », et la consultation d'une déclaration fiscale en fait partie.
  -- ⚠️ SIGNED_URL_ISSUED est reporté en 'VIEW' : la liste d'actions d'audit_log
  -- est un contrat de 0003 qu'on n'élargit pas pour un détail de transport. Le
  -- journal d'accès, lui, conserve la distinction.
  insert into public.audit_log (
    entity_id, actor_id, actor_email, action, entity_table, entity_id_ref,
    after, ip_address, user_agent
  )
  values (
    target.entity_id,
    auth.uid(),
    (select p.email::text from public.profiles p where p.id = auth.uid()),
    case when p_action = 'DOWNLOAD' then 'DOWNLOAD' else 'VIEW' end,
    'documents',
    p_document_id::text,
    jsonb_build_object(
      'access_action', p_action,
      'occurrence_id', target.occurrence_id,
      'normalized_filename', target.normalized_filename),
    p_ip,
    p_user_agent
  );
end;
$fn$;

comment on function public.log_document_access(uuid, text, inet, text) is
  'Seule écriture possible dans document_access_log, et unique porte d''entrée '
  'des accès dans audit_log. `actor_id` est pris de la session, jamais d''un '
  'paramètre : une consultation ne peut pas être attribuée à autrui. Le droit de '
  'lecture est revérifié parce que SECURITY DEFINER neutralise la RLS. '
  '⚠️ Les deux écritures sont dans la MÊME transaction que l''émission de l''URL '
  'signée : si l''une échoue, aucune URL n''est délivrée. Une lecture invisible '
  'vaudrait moins qu''une lecture refusée.';

-- =============================================================================
-- 5. RECHERCHE TRANSVERSE
-- =============================================================================

create view public.documents_search
  with (security_invoker = true)
  as
  select d.id,
         d.occurrence_id,
         d.checklist_item_id,
         d.original_filename,
         d.normalized_filename,
         d.mime_type,
         d.size_bytes,
         -- Exposée pour la fiche de la pièce : l'empreinte est ce que le contrôle
         -- d'intégrité compare, l'afficher permet de la recouper à la main.
         d.sha256,
         d.version,
         d.supersedes_id,
         d.document_kind,
         d.uploaded_at,
         d.uploaded_by,
         d.integrity_status,
         d.integrity_checked_at,
         p.full_name as uploader_name,
         oc.period_key,
         oc.period_start,
         oc.legal_due_date,
         oc.status as occurrence_status,
         ot.id as obligation_type_id,
         ot.code as obligation_code,
         ot.name as obligation_name,
         dom.id as domain_id,
         dom.code as domain_code,
         au.id as authority_id,
         au.name as authority_name,
         not exists (
           select 1 from public.documents newer
           where newer.supersedes_id = d.id and newer.deleted_at is null
         ) as is_current_version,
         -- Colonne de recherche : un seul texte à filtrer, plutôt que six OR
         -- reconstruits à chaque appel côté applicatif.
         concat_ws(' ',
           d.original_filename, d.normalized_filename,
           ot.code, ot.name, oc.period_key, au.name, p.full_name) as search_text
  from public.documents d
  join public.obligation_occurrences oc on oc.id = d.occurrence_id
  join public.obligation_types ot on ot.id = oc.obligation_type_id
  left join public.domains dom on dom.id = ot.domain_id
  left join public.authorities au on au.id = ot.authority_id
  left join public.profiles p on p.id = d.uploaded_by
  where d.deleted_at is null;

comment on view public.documents_search is
  'Vue de recherche transverse (/documents). security_invoker : le filtrage est '
  'celui de la politique `documents`, donc le cloisonnement par domaine s''applique '
  'intégralement — un utilisateur ne peut pas atteindre par la recherche une pièce '
  'que la fiche de dossier lui refuserait. `search_text` agrège les champs '
  'interrogeables pour qu''un seul ILIKE remplace six.';

grant select on public.documents_search to authenticated;

-- =============================================================================
-- 6. RÉGLAGES
-- =============================================================================

insert into public.app_settings (key, value, description, value_type) values
  ('upload_ticket_ttl_seconds', '900'::jsonb,
   'Durée de validité d''un billet de dépôt, en secondes. Doit couvrir l''envoi du plus gros fichier admis sur la liaison la plus lente.',
   'integer'),
  ('occurrence_total_bytes_limit', '209715200'::jsonb,
   'Volume cumulé maximal des pièces d''un même dossier, en octets.', 'integer'),
  ('integrity_sample_ratio_percent', '10'::jsonb,
   'Part des documents recalculés à chaque passe de contrôle d''intégrité, en pourcentage.',
   'integer'),
  ('integrity_sample_minimum', '50'::jsonb,
   'Nombre plancher de documents recalculés par passe, quel que soit le pourcentage.',
   'integer')
on conflict (key) do nothing;

-- Le type conteneur ZIP annoncé par certains navigateurs Windows manquait à la
-- liste du bucket alors qu'il figurait dans celle du serveur applicatif. Les deux
-- listes doivent coïncider : depuis 0009, c'est celle du bucket qui fait foi et
-- que la base relit — une divergence produirait un billet émis pour un envoi que
-- le stockage refuserait ensuite.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv',
  'text/plain',
  'application/xml',
  'text/xml',
  'application/zip',
  'application/x-zip-compressed'
]
where id = 'compliance-documents';

-- =============================================================================
-- 7. SUPPRESSION LOGIQUE — refus sur dossier archivé
-- =============================================================================

create or replace function public.soft_delete_document(
  p_document_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  target record;
  affected int;
begin
  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'Un motif d''au moins 10 caractères est requis.' using errcode = '22023';
  end if;

  select d.occurrence_id, oc.status, oc.is_locked into target
  from public.documents d
  join public.obligation_occurrences oc on oc.id = d.occurrence_id
  where d.id = p_document_id and d.deleted_at is null;

  if target.occurrence_id is null then
    raise exception 'Document introuvable.' using errcode = '42501';
  end if;

  if not public.has_permission_in_domain(
       'document.delete', public.obligation_domain_of_occurrence(target.occurrence_id))
  then
    raise exception 'Suppression refusée.' using errcode = '42501';
  end if;

  -- ⚠️ Une pièce rattachée à un dossier ARCHIVÉ ne se retire plus. Un dossier
  -- archivé est le dossier tel qu'il a été déposé à l'administration : en
  -- soustraire une pièce a posteriori rendrait l'archive infidèle.
  if target.status = 'ARCHIVED' then
    raise exception 'Un dossier archivé ne peut plus être modifié.' using errcode = '42501';
  end if;

  update public.documents
  set deleted_at = now(),
      deleted_by = public.current_profile_id(),
      deletion_reason = trim(p_reason)
  where id = p_document_id and deleted_at is null;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$fn$;

comment on function public.soft_delete_document(uuid, text) is
  'Retrait LOGIQUE d''une pièce. SECURITY DEFINER par nécessité : poser '
  'deleted_at fait sortir la ligne de `documents_select`, et PostgreSQL refuse '
  'un UPDATE dont la ligne RÉSULTANTE ne satisfait plus les politiques SELECT — '
  'le droit est donc revérifié ici, à la main. '
  '⚠️ L''objet reste dans le bucket : aucune politique DELETE n''y existe, '
  'délibérément. La purge relève de la politique de rétention et d''une décision '
  'humaine, jamais d''une suppression applicative.';

grant execute on function public.soft_delete_document(uuid, text) to authenticated;

-- =============================================================================
-- 8. L'INSERTION DIRECTE DE PIÈCES EST FERMÉE
-- =============================================================================

-- ⚠️ FAILLE CORRIGÉE ICI, constatée en éprouvant 0009 contre la base.
--
-- Jusqu'à présent, `documents_insert` laissait toute session détenant
-- `document.upload` insérer une ligne `documents` avec le `storage_path` de son
-- choix. La contrainte d'unicité sur ce chemin empêchait de revendiquer celui
-- d'une pièce existante — mais pas celui d'un objet ORPHELIN.
--
-- Le contournement était complet :
--   1. demander un billet — la réponse contient le chemin de destination ;
--   2. y téléverser un exécutable renommé en .pdf ;
--   3. laisser la confirmation le refuser : le billet est rejeté, mais l'objet
--      reste écrit dans le bucket, à un chemin désormais connu et sans ligne ;
--   4. insérer soi-même une ligne `documents` portant ce chemin.
-- L'objet redevenait lisible — la politique de lecture de storage.objects se
-- contente d'exiger une ligne visible portant ce chemin — et la pièce
-- apparaissait dans le dossier comme un dépôt régulier. Le contrôle de signature
-- binaire était intégralement contourné, alors qu'il est le critère d'acceptation
-- central de cette phase.
--
-- Correctif : plus personne n'insère de ligne `documents` à la main. La seule
-- porte est `confirm_document_upload`, qui ne pose JAMAIS qu'un chemin composé
-- par la base à partir d'un billet, et seulement après avoir relu les octets
-- réellement stockés.
drop policy if exists documents_insert on public.documents;
revoke insert on public.documents from public, anon, authenticated, service_role;

comment on table public.documents is
  'Pièces justificatives. Le fichier vit dans Storage, la ligne porte son empreinte et '
  'sa traçabilité. Suppression logique uniquement, et jamais sans motif ni auteur. '
  '⚠️ AUCUNE insertion directe : `documents_insert` a été retirée en 0009. Une ligne ne '
  'naît que de `confirm_document_upload`, donc d''un billet, donc d''un chemin composé '
  'par la base et d''un en-tête relu après écriture. Laisser le client choisir un '
  'storage_path revenait à lui laisser adopter n''importe quel objet orphelin du bucket, '
  'et donc à contourner la vérification de signature binaire.';

-- =============================================================================
-- 9. LECTURE DE L'OBJET EN COURS DE DÉPÔT
-- =============================================================================

-- ⚠️ DÉFAUT DE CONCEPTION CORRIGÉ ICI, constaté en éprouvant le dépôt dans un
-- vrai navigateur.
--
-- La politique de lecture de 0003 exige, pour voir un objet, qu'une ligne
-- `documents` porte son chemin. C'est la bonne règle — mais elle rendait la
-- vérification de signature IMPOSSIBLE : entre l'envoi direct et la
-- confirmation, le serveur doit relire l'en-tête de ce qui vient d'être écrit,
-- et cette ligne n'existe précisément pas encore. Le PUT réussissait, la
-- relecture échouait, et le dépôt se soldait par « objet absent du stockage ».
-- Autrement dit : le contrôle censé refuser un exécutable renommé en .pdf ne
-- s'exécutait jamais dans le flux réel.
--
-- On ouvre donc une seconde voie, la plus étroite possible : le porteur d'un
-- billet OUVERT, NON EXPIRÉ et NON CONSOMMÉ peut lire l'objet situé au chemin
-- que ce billet désigne. Comme le chemin est composé par la base et contient
-- l'identifiant du billet, cela ne donne accès qu'à l'objet que l'on est
-- soi-même en train de déposer — dont on détient déjà les octets. Dès la
-- confirmation, le billet est consommé et l'accès repasse par la ligne
-- `documents`, donc par le cloisonnement habituel. En cas de rejet ou
-- d'expiration, il n'en reste aucun.
drop policy if exists compliance_documents_select on storage.objects;

create policy compliance_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'compliance-documents'
    and (
      exists (select 1 from public.documents d where d.storage_path = name)
      or exists (
        select 1
        from public.document_upload_tickets t
        where t.storage_path = name
          and t.created_by = public.current_profile_id()
          and t.consumed_at is null
          and t.rejected_at is null
          and t.expires_at > now()
      )
    )
  );

-- =============================================================================
-- 10. MÉNAGE DES DÉPÔTS INABOUTIS
-- =============================================================================

create or replace function public.abandoned_upload_objects(p_older_than_hours int default 24)
returns table (ticket_id uuid, bucket text, storage_path text, reason text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select t.id, t.bucket, t.storage_path,
         case when t.rejected_at is not null then 'REJECTED' else 'EXPIRED' end
  from public.document_upload_tickets t
  where t.consumed_at is null
    and (
      (t.rejected_at is not null and t.rejected_at < now() - make_interval(hours => p_older_than_hours))
      or (t.rejected_at is null and t.expires_at < now() - make_interval(hours => p_older_than_hours))
    );
$fn$;

comment on function public.abandoned_upload_objects(int) is
  'Objets écrits dans le bucket pour un dépôt qui n''a jamais abouti — billet '
  'rejeté par le contrôle de signature, ou expiré sans confirmation. '
  '⚠️ Ce ne sont PAS des documents : aucune ligne `documents` ne les décrit, '
  'personne ne peut les lire, et ils n''ont jamais fait partie d''un dossier. '
  'Les effacer n''est donc pas une suppression de donnée métier — l''interdiction '
  'de toute purge automatique porte sur les pièces, pas sur les octets d''un '
  'envoi avorté. Le délai de grâce évite d''effacer un envoi encore en cours.';

revoke execute on function public.abandoned_upload_objects(int)
  from public, anon, authenticated;
