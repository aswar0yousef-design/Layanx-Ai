# Google Operations Agent

The runtime now exposes bounded Google capabilities without duplicating the existing business/media/commerce layers.

## Capabilities
- Gmail search/read/send
- Drive listing/folder creation
- Sheets creation/row append
- Calendar upcoming events
- Merchant Center account/product listing

Authentication is local-only: either a short-lived `GOOGLE_ACCESS_TOKEN` or OAuth refresh-token credentials in environment variables. The connector refreshes access tokens in memory and does not persist credentials.

## Intended daily operations
The primitives are designed to support a higher-level workflow:
1. Search Gmail for new shipping invoices, customer conversations, store notifications and follow-ups.
2. Read relevant messages and extract structured fields with the existing LayanX model router.
3. Check idempotency before writing.
4. Create/locate a company-specific Drive/Sheets destination.
5. Append invoice number, date, amount, sender, recipient, shipment/order reference and status.
6. Record an audit event and verify the resulting Sheet write.
7. Create drafts/follow-ups for customer messages; sending remains L4_EXECUTE.

This layer intentionally avoids destructive Google actions and avoids a second business database. Existing LayanX storage, verification, idempotency and business managers remain authoritative.
