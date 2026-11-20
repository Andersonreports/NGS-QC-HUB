"""Tiny, additive schema migrations for SQLite.

`Base.metadata.create_all()` only creates tables that don't exist yet — it never adds a
new column to a table that's already there. So whenever a model gains a column, an
already-running deployment's database needs that column added by hand, or every query
against it starts failing with "no such column". This runs once at startup, is a no-op
once the columns are present, and never touches existing data.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# table -> [(column_name, sql_type), ...] to add if missing.
ADDITIVE_COLUMNS = {
    "sheets": [
        ("source_sheet_name", "TEXT"),
        ("source_attachment_id", "TEXT"),
    ],
    "notifications": [
        # DEFAULT here (unlike the columns above) because existing rows need a
        # real value straight away — the frontend distinguishes "new transfer"
        # notifications by this field, and a NULL would just silently fail to
        # highlight every notification that existed before this column did.
        ("kind", "TEXT DEFAULT 'update'"),
    ],
}


# One-shot remaps of retired workflow stage ids onto the current ones, for runs that
# were already in flight when the approval model changed. Idempotent: only rows still
# carrying a retired id are touched, so this is a no-op once they're all migrated.
# Kept in sync with workflow.LEGACY_STAGE_ALIAS.
STAGE_REMAP = {
    "primary_head_review": "excel_head_review",
    "wetlab_qc_review": "excel_head_review",
    "bioinfo_review": "excel_head_review",
    "wetlab_final_review": "pdf_head_review",
}


def run_migrations(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, columns in ADDITIVE_COLUMNS.items():
            if table not in existing_tables:
                continue  # a brand-new database gets every column straight from create_all()
            present = {c["name"] for c in inspector.get_columns(table)}
            for name, sql_type in columns:
                if name in present:
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
                print(f"[migration] added {table}.{name}")

        # Move any in-flight run off a retired review stage. History entries keep their
        # original stage ids (the audit trail is left intact); only the run's current
        # position is remapped so it resolves to a live stage.
        if "runs" in existing_tables:
            for old_stage, new_stage in STAGE_REMAP.items():
                result = conn.execute(
                    text("UPDATE runs SET current_stage = :new WHERE current_stage = :old"),
                    {"new": new_stage, "old": old_stage},
                )
                if result.rowcount:
                    print(f"[migration] remapped {result.rowcount} run(s): {old_stage} -> {new_stage}")
