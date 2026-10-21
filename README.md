# NextVPN VLESS Bridge for Surge

Auto-syncing NextVPN VLESS Reality nodes and converting them to native Trojan-over-WebSocket for Surge iOS / Mac.

## Features
- **Auto Upstream Sync**: Fetches upstream subscription every 1 hour and dynamically reloads sing-box.
- **Native Surge Support**: Exposes standard Trojan over WebSocket (WSS) nodes.
- **Dynamic Subscription**: Provides `/surge.conf?token=...` for Surge's `policy-path`.
