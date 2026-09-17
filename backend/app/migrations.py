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
