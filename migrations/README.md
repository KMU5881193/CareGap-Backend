SQL migrations: NNNN_beN_description.sql. Applied files are immutable. Common schema requires BE1 and affected domain review. No business schema is pre-created. Runner permits only loopback caregap_local.

The runner applies only `migrations/*.sql`, in file-name order, one transaction per file. `migrations/drafts/` is not applied. The BE2 draft stays there until `0001_be1_create_users_table.sql` is present in `migrations/` and the common schema is accepted. See `docs/be2-schema.md`.
