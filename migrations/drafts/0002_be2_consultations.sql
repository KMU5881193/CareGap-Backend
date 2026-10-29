-- Draft only. scripts/migrate.ts reads migrations/*.sql and does not read this directory.
-- Do not move this file to migrations/ until 0001_be1_create_users_table.sql is in that
-- directory and BE1 plus the affected domains accept the common schema.
-- This file assumes public.users(user_id) already exists. It does not create users.
-- It does not reference a persons table. person_id is not a user id.
-- Availability windows and appointment exclusion constraints are omitted on purpose.
-- See docs/be2-schema.md.

CREATE TABLE appointments (
    appointment_id uuid PRIMARY KEY,
    person_id uuid NOT NULL,
    staff_user_id uuid NOT NULL,
    requester_user_id uuid,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status text NOT NULL,
    created_at timestamptz,
    updated_at timestamptz,
    CONSTRAINT appointments_time_ordered CHECK (ends_at > starts_at),
    CONSTRAINT appointments_status_present CHECK (char_length(status) > 0),
    CONSTRAINT appointments_staff_user_fk FOREIGN KEY (staff_user_id) REFERENCES users (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT appointments_requester_user_fk FOREIGN KEY (requester_user_id) REFERENCES users (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX appointments_staff_user_id_idx ON appointments (staff_user_id);
CREATE INDEX appointments_requester_user_id_idx ON appointments (requester_user_id);
CREATE INDEX appointments_person_id_idx ON appointments (person_id);
CREATE INDEX appointments_staff_starts_at_idx ON appointments (staff_user_id, starts_at);
CREATE INDEX appointments_person_starts_at_idx ON appointments (person_id, starts_at);

COMMENT ON TABLE appointments IS 'BE2 appointments. status is an open string. requester_user_id is not assumed to equal staff_user_id.';
COMMENT ON COLUMN appointments.person_id IS 'Care subject id. No persons table FK until that table exists.';

CREATE TABLE consultations (
    consultation_id uuid PRIMARY KEY,
    person_id uuid NOT NULL,
    appointment_id uuid,
    CONSTRAINT consultations_identity_key UNIQUE (consultation_id, person_id),
    CONSTRAINT consultations_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments (appointment_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX consultations_person_id_idx ON consultations (person_id);
CREATE INDEX consultations_appointment_id_idx ON consultations (appointment_id);

COMMENT ON TABLE consultations IS 'BE2 consultation header. Author and created time are not columns yet.';
COMMENT ON COLUMN consultations.person_id IS 'Care subject id. No persons table FK until that table exists.';

CREATE TABLE consultation_record_versions (
    record_version_id uuid PRIMARY KEY,
    consultation_id uuid NOT NULL,
    person_id uuid NOT NULL,
    text text NOT NULL,
    CONSTRAINT consultation_record_versions_identity_key UNIQUE (record_version_id, consultation_id, person_id),
    CONSTRAINT consultation_record_versions_consultation_fk FOREIGN KEY (consultation_id, person_id) REFERENCES consultations (consultation_id, person_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX consultation_record_versions_consultation_id_idx ON consultation_record_versions (consultation_id);

COMMENT ON TABLE consultation_record_versions IS 'Immutable source text. BE3 references consultation_id and record_version_id together.';
COMMENT ON COLUMN consultation_record_versions.text IS 'Consultation source text. Do not copy this column into notifications.';

CREATE FUNCTION be2_reject_record_version_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'consultation_record_versions cannot be updated or deleted';
END;
$$;

CREATE TRIGGER consultation_record_versions_no_change
BEFORE UPDATE OR DELETE ON consultation_record_versions
FOR EACH ROW
EXECUTE FUNCTION be2_reject_record_version_change();

CREATE TABLE follow_up_tasks (
    follow_up_id uuid PRIMARY KEY,
    person_id uuid NOT NULL,
    title text NOT NULL,
    status text NOT NULL,
    consultation_id uuid,
    record_version_id uuid,
    assignee_user_id uuid,
    due_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    CONSTRAINT follow_up_tasks_status_present CHECK (char_length(status) > 0),
    CONSTRAINT follow_up_tasks_source_pair CHECK (
        (consultation_id IS NULL AND record_version_id IS NULL)
        OR (consultation_id IS NOT NULL AND record_version_id IS NOT NULL)
    ),
    CONSTRAINT follow_up_tasks_assignee_user_fk FOREIGN KEY (assignee_user_id) REFERENCES users (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT follow_up_tasks_version_fk FOREIGN KEY (record_version_id, consultation_id, person_id) REFERENCES consultation_record_versions (record_version_id, consultation_id, person_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX follow_up_tasks_person_id_idx ON follow_up_tasks (person_id);
CREATE INDEX follow_up_tasks_assignee_user_id_idx ON follow_up_tasks (assignee_user_id);
CREATE INDEX follow_up_tasks_record_version_id_idx ON follow_up_tasks (record_version_id);

COMMENT ON TABLE follow_up_tasks IS 'BE2 follow-up tasks. Status names are not a closed list. Source columns stay fixed after insert.';

CREATE FUNCTION be2_reject_follow_up_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.follow_up_id IS DISTINCT FROM OLD.follow_up_id
        OR NEW.person_id IS DISTINCT FROM OLD.person_id
        OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
        OR NEW.record_version_id IS DISTINCT FROM OLD.record_version_id
    THEN
        RAISE EXCEPTION 'follow_up identity columns cannot change';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER follow_up_tasks_identity_no_change
BEFORE UPDATE ON follow_up_tasks
FOR EACH ROW
EXECUTE FUNCTION be2_reject_follow_up_identity_change();

CREATE TABLE notifications (
    notification_id uuid PRIMARY KEY,
    recipient_user_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    event_id uuid,
    appointment_id uuid,
    follow_up_id uuid,
    person_id uuid,
    created_at timestamptz,
    read_at timestamptz,
    CONSTRAINT notifications_kind_present CHECK (char_length(kind) > 0),
    CONSTRAINT notifications_recipient_user_fk FOREIGN KEY (recipient_user_id) REFERENCES users (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT notifications_appointment_fk FOREIGN KEY (appointment_id) REFERENCES appointments (appointment_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT notifications_follow_up_fk FOREIGN KEY (follow_up_id) REFERENCES follow_up_tasks (follow_up_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX notifications_recipient_user_id_idx ON notifications (recipient_user_id);
CREATE INDEX notifications_event_id_idx ON notifications (event_id);
CREATE INDEX notifications_appointment_id_idx ON notifications (appointment_id);
CREATE INDEX notifications_follow_up_id_idx ON notifications (follow_up_id);
CREATE INDEX notifications_person_id_idx ON notifications (person_id);

COMMENT ON TABLE notifications IS 'BE2 notifications. event_id is not unique. There is no delivery timestamp.';
COMMENT ON COLUMN notifications.body IS 'Caller-written display text. Not a copy of consultation_record_versions.text.';
COMMENT ON COLUMN notifications.read_at IS 'Null means unread. This is not a push delivery time.';
COMMENT ON COLUMN notifications.event_id IS 'Optional source event. Many notifications may share one event_id.';

REVOKE ALL ON TABLE appointments FROM PUBLIC;
REVOKE ALL ON TABLE consultations FROM PUBLIC;
REVOKE ALL ON TABLE consultation_record_versions FROM PUBLIC;
REVOKE ALL ON TABLE follow_up_tasks FROM PUBLIC;
REVOKE ALL ON TABLE notifications FROM PUBLIC;
REVOKE ALL ON FUNCTION be2_reject_record_version_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION be2_reject_follow_up_identity_change() FROM PUBLIC;
