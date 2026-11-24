"""Multi-organization support: one codebase, one separate database + upload folder per
organization. The active organization for a request is held in a context variable set by
middleware from the X-Org header, so every query and file path below it is automatically
scoped to that organization's own data.
"""
from contextvars import ContextVar

ORG_IDS = ("ngs", "cmc")
DEFAULT_ORG = "ngs"

current_org: ContextVar[str] = ContextVar("current_org", default=DEFAULT_ORG)


def normalize_org(value) -> str | None:
    v = (value or "").strip().lower()
    return v if v in ORG_IDS else None
