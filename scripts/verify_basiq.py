"""Read-only manual check that the Basiq bank-feed credentials work.

Run AFTER setting ``BASIQ_ENABLED=true`` and ``BASIQ_API_KEY=<key>`` in the
environment (locally in ``.env`` or on the API service):

    .venv/bin/python -m scripts.verify_basiq             # auth check only
    .venv/bin/python -m scripts.verify_basiq <user_id>   # + list transactions

It only reads: it mints a short-lived Basiq server token and, when given an
already-connected ``basiq_user_id``, lists a few transactions. It never creates
a user, never connects a bank, and never moves money -- connect a bank through
the app (Settings -> Bank feed -> Connect) using Basiq's hosted consent UI and
a sandbox test institution.
"""

from __future__ import annotations

import sys

from stewart.core.settings import get_settings
from stewart.integrations.basiq import (
    BasiqIntegrationError,
    basiq_server_token,
    fetch_transactions,
    is_configured,
)


def main(argv: list[str]) -> int:
    settings = get_settings()
    if not is_configured(settings):
        print("Basiq is not configured. Set BASIQ_ENABLED=true and BASIQ_API_KEY=<key>.")
        return 1

    print(f"Basiq base URL: {settings.basiq_api_base_url}")
    try:
        token = basiq_server_token(settings)
    except BasiqIntegrationError as exc:
        print(f"FAILED to mint a Basiq server token: {exc}")
        return 1
    print(f"OK: minted a Basiq server token (length {len(token)}).")

    basiq_user_id = argv[1] if len(argv) > 1 else None
    if basiq_user_id is None:
        print(
            "Auth verified. To check a live fetch, connect a bank in the app "
            "(Settings -> Bank feed -> Connect), then re-run with the "
            "basiq_user_id, or use 'Fetch from connected bank feed' in the app."
        )
        return 0

    result = fetch_transactions(settings, basiq_user_id=basiq_user_id)
    print(f"fetch status={result.status}, transactions={len(result.transactions)}")
    if result.error:
        print(f"detail: {result.error}")
    for txn in result.transactions[:10]:
        amount = txn.amount_cents / 100
        print(f"  {txn.posted_date} ${amount:.2f} ref={txn.reference!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
