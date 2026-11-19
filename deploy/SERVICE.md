# systemd user unit

`pisound.service` runs pisound as a systemd user service.

Expected layout (relative to the service user's home, `%h`):

- app checkout (built, with `dist/`): `~/apps/pisound`
- environment file: `~/apps/pisound.env` (all settings and secrets live here, never in git)
- Node.js: `~/.local/bin/node`

Install:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/pisound.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now pisound
loginctl enable-linger "$USER"   # once, so it runs without a login session
```

Status and logs: `systemctl --user status pisound`, `journalctl --user -u pisound -f`.
