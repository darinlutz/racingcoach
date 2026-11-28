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

On RacingCoach.app, **Admin > Lighting Control > Configuration**: set the controller's address to the DHCP
reservation you made for the Dig-Quad (e.g. `192.168.1.50`), check each zone's WLED segment, and **Save**. The agent
picks it up within about 5 seconds and keeps a copy in
`~/Library/Application Support/RacingCoachLighting/config.json` for when the site isn't reachable. Only home network
addresses (10.x, 172.16-31.x, 192.168.x, .local names) are accepted.

The site's configuration is the one that counts. The first time the agent connects, if the site has none yet, it
uploads its own `config.json` once (so an address set there before isn't lost); after that, edits to the file on the
Mac are replaced by the site's whenever it changes. Then test:

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

```bash
racingcoach-lighting streamdeck install
```

This makes one small app per key, with a key icon for each, in `~/Applications/RacingCoach Lighting Buttons`. In
Stream Deck, put **System > Open** on each key and choose its app; `Layout.txt` in that folder says which goes where.
The full steps, the 32-key layout and what each key does are in `docs/lighting/STREAM_DECK.md`. None of the keys holds a
password: the commands use the token in `~/Library/Application Support/RacingCoachLighting/local-token`, readable only
by your Mac account.

The commands:

```
racingcoach-lighting scene race|garage|broadcast|night|white|blue|red|off
racingcoach-lighting zone <zone> toggle|on|off|color RRGGBB[WW]|brightness 0-255
racingcoach-lighting color RRGGBB[WW]
racingcoach-lighting brightness increase|decrease|<percent>
racingcoach-lighting mode automatic|manual|test|disabled
racingcoach-lighting test pit-limiter on|off|toggle
racingcoach-lighting test flag yellow|red|green|checkered [on|off|toggle]
racingcoach-lighting all-off | all-on
racingcoach-lighting restore baseline|defaults
racingcoach-lighting status --notify
racingcoach-lighting streamdeck list|install|uninstall
```

`--notify` on any command also shows its answer as a macOS notification.

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
