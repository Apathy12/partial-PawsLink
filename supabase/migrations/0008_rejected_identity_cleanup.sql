-- Rejected IDs must be removed through the Storage API, then their private
-- document details are erased. Keep the decision and reason for resubmission.
alter table public.verification_requests
  alter column id_path drop not null;

alter table public.verification_requests
  drop constraint verification_document_ck;
alter table public.verification_requests
  add constraint verification_document_ck check (
    (status = 'rejected' and id_path is null)
    or (id_path is not null and length(btrim(id_path)) > 0)
  );

alter table public.verification_requests
  drop constraint verification_role_document_ck;
alter table public.verification_requests
  add constraint verification_role_document_ck check (
    (requested_role = 'vet' and id_type = 'prc_id' and (
      status = 'rejected' or (
        length(btrim(coalesce(clinic_name, ''))) > 0
        and length(btrim(coalesce(prc_number, ''))) > 0
      )
    ))
    or (requested_role = 'user' and id_type <> 'prc_id')
  );

create or replace function public.guard_verification_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_cavd() then
    raise exception 'Only CAVD staff can review identity documents';
  end if;

  if old.status = 'rejected' then
    if old.id_path is null or new.id_path is not null
       or new.status is distinct from old.status
       or new.user_id is distinct from old.user_id
       or new.requested_role is distinct from old.requested_role
       or new.id_type is distinct from old.id_type
       or new.review_note is distinct from old.review_note
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.created_at is distinct from old.created_at
       or new.clinic_name is not null or new.prc_number is not null then
      raise exception 'Only rejected ID document details may be cleared';
    end if;
    if exists (
      select 1 from storage.objects
      where bucket_id = 'identity-documents' and name = old.id_path
    ) then
      raise exception 'Delete the rejected ID with the Storage API first';
    end if;
    return new;
  end if;

  if old.status <> 'pending' then
    raise exception 'This request has already been reviewed';
  end if;
  if new.status not in ('approved', 'rejected') then
    raise exception 'Review must approve or reject the request';
  end if;
  if new.user_id is distinct from old.user_id
     or new.requested_role is distinct from old.requested_role
     or new.id_type is distinct from old.id_type
     or new.id_path is distinct from old.id_path
     or new.clinic_name is distinct from old.clinic_name
     or new.prc_number is distinct from old.prc_number
     or new.created_at is distinct from old.created_at then
    raise exception 'Submitted identity details cannot be changed';
  end if;
  if new.status = 'rejected' and length(btrim(coalesce(new.review_note, ''))) = 0 then
    raise exception 'A rejection needs a reason';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end
$$;

-- CAVD may remove only files belonging to rejected requests. Applicants may
-- remove an upload only if no request was created for it (failed submission).
create policy "identity documents deleted after rejection"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'identity-documents'
    and public.is_cavd()
    and exists (
      select 1 from public.verification_requests r
      where r.status = 'rejected' and r.id_path = name
    )
  );

create policy "unsubmitted identity uploads deleted by applicant"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'identity-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.verification_requests r where r.id_path = name
    )
  );
