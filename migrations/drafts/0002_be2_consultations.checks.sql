-- Integrity checks for the BE2 draft. Not an applied migration.
-- Run with psql after 0001 and 0002_be2_consultations.sql.
-- Requires public.users. Failure messages do not include consultation text.
-- The final ROLLBACK drops the fixture rows and keeps the tables.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (user_id, email, password_hash, name, role, status)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'be2-staff-fixture@example.test', 'not-a-secret', 'synthetic staff', 'staff', 'APPROVED'),
    ('22222222-2222-4222-8222-222222222222', 'be2-patient-fixture@example.test', 'not-a-secret', 'synthetic account', 'patient', 'APPROVED');

DO $$
DECLARE
    unique_event_constraints integer;
    sent_columns integer;
    source_columns integer;
BEGIN
    SELECT count(*) INTO unique_event_constraints
    FROM pg_constraint
    WHERE conrelid = 'notifications'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%event_id%';
    IF unique_event_constraints <> 0 THEN
        RAISE EXCEPTION 'event_id must not be unique';
    END IF;

    SELECT count(*) INTO sent_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name IN ('sent_at', 'delivered_at');
    IF sent_columns <> 0 THEN
        RAISE EXCEPTION 'notification delivery columns must stay absent';
    END IF;

    SELECT count(*) INTO source_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'text';
    IF source_columns <> 0 THEN
        RAISE EXCEPTION 'notifications must not store a source text column';
    END IF;
END $$;

DO $$
BEGIN
    BEGIN
        INSERT INTO appointments (
            appointment_id, person_id, staff_user_id, starts_at, ends_at, status
        ) VALUES (
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            '99999999-9999-4999-8999-999999999999',
            '2026-11-02T00:00:00Z',
            '2026-11-02T01:00:00Z',
            'fixture-open'
        );
        RAISE EXCEPTION 'missing staff user was accepted';
    EXCEPTION
        WHEN foreign_key_violation THEN
            NULL;
    END;
END $$;

DO $$
BEGIN
    BEGIN
        INSERT INTO appointments (
            appointment_id, person_id, staff_user_id, starts_at, ends_at, status
        ) VALUES (
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            '11111111-1111-4111-8111-111111111111',
            '2026-11-02T02:00:00Z',
            '2026-11-02T02:00:00Z',
            'fixture-open'
        );
        RAISE EXCEPTION 'unordered appointment interval was accepted';
    EXCEPTION
        WHEN check_violation THEN
            NULL;
    END;
END $$;

DO $$
BEGIN
    BEGIN
        INSERT INTO appointments (
            appointment_id, person_id, staff_user_id, starts_at, ends_at, status
        ) VALUES (
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            '11111111-1111-4111-8111-111111111111',
            '2026-11-02T03:00:00Z',
            '2026-11-02T04:00:00Z',
            ''
        );
        RAISE EXCEPTION 'empty appointment status was accepted';
    EXCEPTION
        WHEN check_violation THEN
            NULL;
    END;
END $$;

INSERT INTO appointments (
    appointment_id, person_id, staff_user_id, requester_user_id, starts_at, ends_at, status
) VALUES (
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '2026-11-02T00:00:00Z',
    '2026-11-02T01:00:00Z',
    'fixture-open'
);

INSERT INTO consultations (consultation_id, person_id, appointment_id)
VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);

INSERT INTO consultation_record_versions (record_version_id, consultation_id, person_id, text)
VALUES (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'synthetic-record'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO consultation_record_versions (record_version_id, consultation_id, person_id, text)
        VALUES (
            'cccccccc-cccc-4ccc-8ccc-cccccccccccd',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            'synthetic-record-other'
        );
        RAISE EXCEPTION 'version person mismatch was accepted';
    EXCEPTION
        WHEN foreign_key_violation THEN
            NULL;
    END;
END $$;

DO $$
DECLARE
    changed integer;
BEGIN
    BEGIN
        UPDATE consultation_record_versions
        SET text = 'synthetic-record-replaced'
        WHERE record_version_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        GET DIAGNOSTICS changed = ROW_COUNT;
    EXCEPTION
        WHEN raise_exception THEN
            changed := -1;
    END;
    IF changed <> -1 THEN
        RAISE EXCEPTION 'record version update was accepted';
    END IF;
END $$;

DO $$
DECLARE
    stored text;
BEGIN
    SELECT text INTO stored
    FROM consultation_record_versions
    WHERE record_version_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    IF stored IS DISTINCT FROM 'synthetic-record' THEN
        RAISE EXCEPTION 'record version text changed';
    END IF;
END $$;

DO $$
DECLARE
    removed integer;
BEGIN
    BEGIN
        DELETE FROM consultation_record_versions
        WHERE record_version_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        GET DIAGNOSTICS removed = ROW_COUNT;
    EXCEPTION
        WHEN raise_exception THEN
            removed := -1;
    END;
    IF removed <> -1 THEN
        RAISE EXCEPTION 'record version delete was accepted';
    END IF;
END $$;

INSERT INTO follow_up_tasks (follow_up_id, person_id, title, status)
VALUES (
    '12121212-1212-4121-8121-121212121212',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'synthetic task',
    'fixture-open'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO follow_up_tasks (follow_up_id, person_id, title, status, consultation_id)
        VALUES (
            '13131313-1313-4131-8131-131313131313',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            'synthetic task',
            'fixture-open',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        );
        RAISE EXCEPTION 'half follow-up source was accepted';
    EXCEPTION
        WHEN check_violation THEN
            NULL;
    END;
END $$;

DO $$
BEGIN
    BEGIN
        INSERT INTO follow_up_tasks (
            follow_up_id, person_id, title, status, consultation_id, record_version_id
        ) VALUES (
            '14141414-1414-4141-8141-141414141414',
            'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            'synthetic task',
            'fixture-open',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        );
        RAISE EXCEPTION 'follow-up person mismatch was accepted';
    EXCEPTION
        WHEN foreign_key_violation THEN
            NULL;
    END;
END $$;

INSERT INTO follow_up_tasks (
    follow_up_id, person_id, title, status, consultation_id, record_version_id, assignee_user_id
) VALUES (
    '15151515-1515-4151-8151-151515151515',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'synthetic linked task',
    'fixture-open',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '11111111-1111-4111-8111-111111111111'
);

UPDATE follow_up_tasks
SET title = 'synthetic linked task revised', status = 'fixture-done'
WHERE follow_up_id = '15151515-1515-4151-8151-151515151515';

DO $$
DECLARE
    changed integer;
BEGIN
    BEGIN
        UPDATE follow_up_tasks
        SET record_version_id = NULL
        WHERE follow_up_id = '15151515-1515-4151-8151-151515151515';
        GET DIAGNOSTICS changed = ROW_COUNT;
    EXCEPTION
        WHEN raise_exception THEN
            changed := -1;
    END;
    IF changed <> -1 THEN
        RAISE EXCEPTION 'follow-up source change was accepted';
    END IF;
END $$;

DO $$
BEGIN
    BEGIN
        INSERT INTO follow_up_tasks (follow_up_id, person_id, title, status)
        VALUES (
            '15151515-1515-4151-8151-151515151515',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            'other task',
            'fixture-open'
        );
        RAISE EXCEPTION 'duplicate follow_up_id was accepted';
    EXCEPTION
        WHEN unique_violation THEN
            NULL;
    END;
END $$;

INSERT INTO notifications (
    notification_id, recipient_user_id, kind, title, body, event_id, appointment_id, follow_up_id, person_id
) VALUES (
    '16161616-1616-4161-8161-161616161616',
    '22222222-2222-4222-8222-222222222222',
    'fixture-notice',
    'synthetic notice',
    'synthetic display',
    '17171717-1717-4171-8171-171717171717',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '15151515-1515-4151-8151-151515151515',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);

INSERT INTO notifications (
    notification_id, recipient_user_id, kind, title, body, event_id
) VALUES (
    '18181818-1818-4181-8181-181818181818',
    '11111111-1111-4111-8111-111111111111',
    'fixture-other',
    'synthetic other notice',
    'synthetic other display',
    '17171717-1717-4171-8171-171717171717'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO notifications (
            notification_id, recipient_user_id, kind, title, body
        ) VALUES (
            '16161616-1616-4161-8161-161616161616',
            '11111111-1111-4111-8111-111111111111',
            'fixture-notice',
            'other notice',
            'other display'
        );
        RAISE EXCEPTION 'duplicate notification_id was accepted';
    EXCEPTION
        WHEN unique_violation THEN
            NULL;
    END;
END $$;

DO $$
BEGIN
    BEGIN
        INSERT INTO notifications (
            notification_id, recipient_user_id, kind, title, body
        ) VALUES (
            '19191919-1919-4191-8191-191919191919',
            '99999999-9999-4999-8999-999999999999',
            'fixture-notice',
            'synthetic notice',
            'synthetic display'
        );
        RAISE EXCEPTION 'missing notification recipient was accepted';
    EXCEPTION
        WHEN foreign_key_violation THEN
            NULL;
    END;
END $$;

DO $$
DECLARE
    shared_events integer;
    requester uuid;
    staff uuid;
BEGIN
    SELECT count(*) INTO shared_events
    FROM notifications
    WHERE event_id = '17171717-1717-4171-8171-171717171717';
    IF shared_events <> 2 THEN
        RAISE EXCEPTION 'one event did not keep two notifications';
    END IF;

    SELECT requester_user_id, staff_user_id INTO requester, staff
    FROM appointments
    WHERE appointment_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    IF requester IS NOT DISTINCT FROM staff THEN
        RAISE EXCEPTION 'requester and staff were stored as the same user';
    END IF;
END $$;

ROLLBACK;
