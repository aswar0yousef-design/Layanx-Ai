# LayanX Messaging Channels

LayanX supports a shared messaging layer for WhatsApp Cloud API and Telegram.

## Architecture

Both channels normalize inbound messages into the same router:

`WhatsApp / Telegram -> ChannelRouter -> owner/staff/customer policy -> LayanX model/agent -> channel reply`

Owner and staff messages can invoke the LayanX agent. Customer messages use a restricted support prompt and do not receive system/desktop/code/financial/admin execution authority.

## WhatsApp Cloud API

Set:

- `LAYANX_WHATSAPP_ENABLED=true`
- `LAYANX_WHATSAPP_ACCESS_TOKEN`
- `LAYANX_WHATSAPP_PHONE_NUMBER_ID`
- `LAYANX_WHATSAPP_VERIFY_TOKEN`
- `LAYANX_WHATSAPP_APP_SECRET`
- `LAYANX_WHATSAPP_GRAPH_VERSION` (pin the Graph API version used by your Meta app)
- `LAYANX_WHATSAPP_OWNER_IDS` as a comma-separated list of WhatsApp sender IDs allowed to operate LayanX
- optional `LAYANX_WHATSAPP_STAFF_IDS`
- `LAYANX_CHANNEL_OWNER_IDS` / `LAYANX_CHANNEL_STAFF_IDS` remain supported as shared fallback lists

Configure the Meta webhook callback to:

`https://YOUR_DOMAIN/v1/channels/whatsapp/webhook`

GET is used for webhook verification and POST receives messages. The server acknowledges inbound webhooks immediately and processes the agent response asynchronously.

## Telegram

Create a bot with @BotFather and set:

- `LAYANX_TELEGRAM_ENABLED=true`
- `LAYANX_TELEGRAM_BOT_TOKEN`
- `LAYANX_TELEGRAM_OWNER_IDS` using the Telegram numeric user ID
- optional `LAYANX_TELEGRAM_STAFF_IDS`
- `LAYANX_CHANNEL_OWNER_IDS` / `LAYANX_CHANNEL_STAFF_IDS` remain supported as shared fallback lists

LayanX uses Telegram long polling by default, so a public webhook is not required. A webhook can be added later if a public deployment needs push delivery.

## Security

Never put access tokens in source code. Keep them in environment variables or the existing local secret-management deployment layer.

Use separate IDs for WhatsApp and Telegram because their identifier namespaces differ. Customer messages are never treated as owner commands.

The messaging connector does not bypass Meta or Telegram authentication. WhatsApp Cloud API requires Meta's official business setup and credentials; Telegram requires a Bot API token.

## API

- `GET /v1/channels/status`
- `GET /v1/channels/whatsapp/webhook`
- `POST /v1/channels/whatsapp/webhook`

The same router is used for both channels, so adding another messaging provider does not require changing the LayanX agent itself.

## Delivery hardening

Inbound messages are deduplicated by channel and provider message ID for a bounded five-minute window. This protects owner commands from duplicate WhatsApp webhook deliveries. Telegram offsets prevent replay during normal polling.
