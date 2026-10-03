# Multi-device LayanX Remote

LayanX Remote supports multiple independent LayanX Agents from one phone.

## Device model

Each Agent has a persistent deviceId. The ID is stored locally in the Agent data directory and can also be explicitly set with LAYANX_DEVICE_ID. The optional LAYANX_DEVICE_NAME controls the display name.

The mobile app stores each paired device separately in Expo SecureStore:

- device name
- device ID
- Agent API URL
- bearer token

The phone does not merge device state. Selecting a device changes the API target for subsequent operations.

## Pairing

1. Start the Agent on the target computer.
2. Configure a strong LAYANX_API_TOKEN.
3. If the Agent is reachable remotely, bind it to the required LAN/VPN interface.
4. In LayanX Remote, enter the Agent URL and token.
5. Tap Pair / Verify Device.
6. The app calls authenticated GET /v1/device/identity and saves the returned identity.
7. Select that device before controlling missions.

A device is considered paired only after authenticated identity verification. Tokens are stored in Expo SecureStore and are not committed to source control.

## Isolation

Every request is sent to the selected Agent URL. Device A never receives commands intended for Device B through the mobile registry.

Each Agent keeps its own:

- files
- runtime state
- missions
- memory/context
- credentials
- local tools
- execution environment

## Network

For the same LAN, use the computer's LAN address, not localhost.

For remote Internet access, use a private VPN or an authenticated HTTPS relay/reverse proxy. Do not expose the Agent port directly to the public Internet.

## Compatibility

The current mobile app uses the multi-device list. Existing server API authentication remains required for identity and control endpoints.
