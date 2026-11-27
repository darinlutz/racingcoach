# Installing the RacingCoach Lighting Agent on the Mac

The agent runs on the Mac that has the Stream Deck. It needs Node.js 22.18 or later and this repository. Nothing here
opens a port to the internet or needs sudo.

## 1. Install

```bash
brew install node            # or brew upgrade node; node --version must be 22.18 or later
cd ~/path/to/racingcoach     # this repository, up to date (git pull)
lighting-agent/install.sh
```

This links the `racingcoach-lighting` command into `~/.local/bin` (and `/usr/local/bin` when writable), writes
`~/Library/LaunchAgents/app.racingcoach.lighting.plist` with this folder and your Node, and starts the agent. It
starts again at every login and restarts if it stops. If `racingcoach-lighting` isn't found, add
`export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` and open a new Terminal.

## 2. Pair with RacingCoach.app

```bash
racingcoach-lighting pair
```

It prints a code like `K7PR-4MXT`. On RacingCoach.app, signed in as an Admin, open **Admin > Lighting Control >
Agents & Controllers**, type the code and press **Approve** within 10 minutes. The device token goes into your login
Keychain (service `app.racingcoach.lighting`); the running agent picks it up within 30 seconds. To unpair:
`racingcoach-lighting unpair`, or **Remove** on the Admin page.

## 3. Point it at the controller

Edit `~/Library/Application Support/RacingCoachLighting/config.json` (written with defaults on the first start):
set the controller's `host` to the DHCP reservation you made for the Dig-Quad (e.g. `"192.168.1.50"`), and check each
zone's `segmentId` matches the segment in WLED. Only home network addresses (10.x, 172.16-31.x, 192.168.x, .local
names) are accepted. Then restart the agent (below) and test:

```bash
racingcoach-lighting controller-test main   # WLED version, pixel count (should be 42 for 3 m), RGBW, segments
racingcoach-lighting scene white
racingcoach-lighting test pit-limiter on    # blue
racingcoach-lighting test pit-limiter off   # back to white
```

Only the `cockpit` zone is enabled at first (segment 0, the 3 m proof of concept). Set `"enabled": true` on others as
you add them.

## Start, stop, restart, status

```bash
launchctl kickstart -k gui/$(id -u)/app.racingcoach.lighting    # restart (after editing config.json)
launchctl bootout gui/$(id -u)/app.racingcoach.lighting         # stop until the next login
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.racingcoach.lighting.plist   # start again
racingcoach-lighting status                                      # mode, scene, site connection, zones, controllers
racingcoach-lighting ui                                          # the local page in the browser
lighting-agent/install.sh uninstall                              # remove (config and logs stay)
```

Run it in the foreground instead (stop the LaunchAgent first): `racingcoach-lighting run`, or
`racingcoach-lighting run --mock` with no controllers at all.

## Stream Deck

Each button runs one `racingcoach-lighting` command; none holds a password (the commands use the token in
`~/Library/Application Support/RacingCoachLighting/local-token`, readable only by your Mac account).

1. Open **Shortcuts**, make a new shortcut, add **Run Shell Script**, and type the full command, e.g.
   `~/.local/bin/racingcoach-lighting scene race`. Name it (e.g. "Lights: Race").
2. In **Stream Deck**, drag **System > Shortcut** onto a key and choose that shortcut. (If your Stream Deck version
   has no Shortcut action, use **System > Open** with a small `.command` file containing the command.)

The Admin page's **Stream Deck** tab shows the suggested 32-key layout. Commands:

```
racingcoach-lighting scene race|garage|broadcast|night|white|blue|red|off
racingcoach-lighting zone <zone> toggle|on|off|color RRGGBB[WW]|brightness 0-255
racingcoach-lighting brightness increase|decrease|<percent>
racingcoach-lighting mode automatic|manual|test|disabled
racingcoach-lighting test pit-limiter on|off
racingcoach-lighting all-off | all-on
racingcoach-lighting restore baseline|defaults
```

Zones: `cockpit`, `monitor`, `perimeter`, `engineer`, `pedals`, `wall`.

## Troubleshooting

| Symptom | Check |
|---|---|
| "The lighting agent isn't running" | `launchctl print gui/$(id -u)/app.racingcoach.lighting`; `~/Library/Logs/RacingCoachLighting/launchd.log` |
| `status` says `unpaired` | `racingcoach-lighting pair` |
| `status` says `revoked` | it was removed on the Admin page: unpair, pair again, then restart the agent |
| `status` says `reconnecting` | the Mac's internet; the agent retries with backoff up to every 30 s, lights keep working locally |
| Controller `online: false` | `ping <address>`; open `http://<address>/` in a browser; `controller-test main` |
| Lights don't turn blue in a race | the Live Racing page shows the pit limiter? `status` → `telemetryFresh`, `mode` AUTOMATIC |
| Wrong colors | WLED's LED Preferences: color order, and the RGBW type |

The agent's log is `~/Library/Logs/RacingCoachLighting/agent.log` (JSON lines; tokens are never written). For
controller requests too: `racingcoach-lighting diagnostics`.
