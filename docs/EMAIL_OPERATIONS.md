# Email Operations

LayanX now treats Gmail and Yahoo Mail as email sources for the same automation layer.

## Yahoo setup
Yahoo's supported local path is IMAP with an app password:
- IMAP: `imap.mail.yahoo.com:993` over TLS
- SMTP: `smtp.mail.yahoo.com:465` over TLS (587 with TLS is also supported)
- Set `YAHOO_EMAIL` and `YAHOO_APP_PASSWORD`

Yahoo's current help documentation explicitly requires an app password for IMAP and no longer supports plain-password IMAP authentication. Yahoo also documents OAuth for applications that request Mail scopes; restricted Mail access may require developer access approval. citeturn0search8turn1search1

## Agent capabilities
- Search/read/send Yahoo Mail
- Search/read Gmail
- Unified invoice scan across Gmail or Yahoo
- Local-model invoice extraction
- Duplicate prevention
- Google Sheets archival

The invoice tool is `email.invoices.scan`; set payload `provider` to `google` or `yahoo`. This keeps one invoice workflow rather than duplicating business logic.
