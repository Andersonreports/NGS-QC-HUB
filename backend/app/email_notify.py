"""Outgoing mail this app sends: the "new transfer" notice to Bioinfo. Sending
is best-effort — a mail server hiccup should never stop Wet Lab marking a
transfer, so every failure is caught and logged, never raised to the caller.
"""
import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage

from . import config

logger = logging.getLogger("ngsqc.email")


def _send(to_addr: str, subject: str, body: str) -> None:
    if not to_addr:
        logger.info("No recipient configured — skipping email %r", subject)
        return
    if not config.SMTP_HOST:
        logger.info("SMTP not configured — skipping email %r to %s", subject, to_addr)
        return
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = config.SMTP_FROM
    msg["To"] = to_addr
    msg.set_content(body)
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as server:
            if config.SMTP_USE_TLS:
                server.starttls()
            if config.SMTP_USERNAME:
                server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
            server.send_message(msg)
    except Exception:
        logger.exception("Failed to send email %r to %s", subject, to_addr)


def send_new_transfer_email(run_number: str, marked_at: datetime) -> None:
    date_str = marked_at.strftime("%d-%b-%Y")
    body = (
        f"Dear Team,\n\n"
        f"New Run ({run_number}) is placed in the common drive on {date_str}. "
        f"Kindly access.\n"
    )
    _send(config.BIOINFO_NOTIFY_EMAIL, f"New Run Transfer: {run_number}", body)
