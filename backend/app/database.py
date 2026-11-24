from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import org_database_url
from .tenancy import ORG_IDS, current_org

# One engine (and database file) per organization.
engines = {
    org: create_engine(org_database_url(org), connect_args={"check_same_thread": False})
    for org in ORG_IDS
}
_sessionmakers = {
    org: sessionmaker(autocommit=False, autoflush=False, bind=eng) for org, eng in engines.items()
}
Base = declarative_base()


def SessionLocal():
    """A session on the current organization's database."""
    return _sessionmakers[current_org.get()]()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
