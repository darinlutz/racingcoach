# Stream Deck Lighting Profile (Phase 11)

A Stream Deck XL (32 keys, 4 rows of 8) on the Mac controls the sim room's lighting through the
`racingcoach-lighting` command. Each key runs one command against the running agent on `127.0.0.1:8750`. The commands
use the local token in `~/Library/Application Support/RacingCoachLighting/local-token`, so no key holds a password.
This is the proof of concept. A native plugin is evaluated at the end of this page and isn't needed for any of it.

## Setting it up

The agent must be installed and running first (`docs/lighting/MAC_INSTALL.md`, steps 1–3).

1. Make the button apps:

   ```bash
   racingcoach-lighting streamdeck install
   ```

   This creates `~/Applications/RacingCoach Lighting Buttons/` with:
   - 32 small apps, `01 Automatic.app` to `32 Lighting Page.app`. Each is an AppleScript applet that runs its command
     with no Terminal window and no Dock icon.
   - `Icons/`, with a 144×144 key icon for each key in its color.
   - `Layout.txt`, which says which app goes on which key.

   The zone keys use your installation's zones: the running agent's configuration, else `config.json`, else the
   defaults. Run the command again after adding or renaming zones. It rebuilds the folder from scratch, so remove the
   old keys' actions in Stream Deck first if their names changed.
2. Open **Stream Deck** and make a new profile: **Preferences > Profiles > +**, named "RacingCoach Lighting".
3. For each key in `Layout.txt`:
   1. Drag **System > Open** from the action list onto the key.
   2. Under **App / File**, click **Choose** and pick that key's app in `~/Applications/RacingCoach Lighting Buttons`.
   3. Type its **Title**, e.g. "Race". Use a short one: two lines of about 8 letters fit.
   4. Click the key image in the action's settings, choose **Set from File**, and pick the icon of the same name in
      `Icons/`.
4. Press **Status**. A notification shows the mode, scene, any racing event in force, the brightness, the site
   connection and how many controllers are online.

The first time a button app runs, macOS may ask whether to allow it. Allow it once. If a key does nothing, run its
command in Terminal (see `Layout.txt`) to see the error.

To remove the apps, run `racingcoach-lighting streamdeck uninstall`. It only deletes a folder that
`streamdeck install` made.

### Without the apps

Any key can instead run a Shortcuts shortcut:

1. In **Shortcuts**, make a shortcut with one **Run Shell Script** action holding the full command, e.g.
   `RC_LIGHTING_BUTTON=1 ~/.local/bin/racingcoach-lighting scene race`.
2. In Stream Deck, put **System > Shortcut** on the key and pick that shortcut.

Shortcuts starts more slowly than an applet.

## Feedback

A key has no screen to print to, so:

- **Failures always show a notification.** The apps set `RC_LIGHTING_BUTTON=1`. Examples: the agent isn't running,
  there's no such scene, or a test event has no enabled rule.
- **`--notify` also shows the answer.** The Status, test and Restore Defaults keys use it.

The lights themselves show that the other keys worked.

## The layout

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| **1 Modes** | Automatic | Manual | Test Mode | Disabled | All On | All Off | Dimmer | Brighter |
| **2 Scenes** | Race | Garage | Broadcast | Night | White | Blue | Red | Scene Off |
| **3 Zones** | Cockpit | Monitor | Perimeter | Engineer | Pedals | Wall | Green | Amber |
| **4 Tests** | Pit Limiter Test | Yellow Flag Test | Red Flag Test | Purple | Restore Baseline | Restore Defaults | Status | Lighting Page |

What each key does:

- **Modes:**
  - `mode automatic|manual|test|disabled`.
  - `all-on`, `all-off`.
  - `brightness decrease|increase`: the master brightness in steps of 10%.
- **Scenes:** `scene <id>`. Picking a scene drops the manual changes made on top of the old one, except for protected
  zones.
- **Zones:** `zone <id> toggle` for the first six zones of the configuration. A disabled zone (not wired yet) gets a
  key too, but nothing is sent to it until it's enabled.
- **Colors:**
  - `color RRGGBB[WW]` puts every enabled, unprotected zone in one color, on top of the scene. The pedals and the
    engineer's light are protected, so color keys leave them alone.
  - A scene key or Restore Defaults undoes a color key.
- **Tests:**
  - `test pit-limiter toggle` and `test flag yellow|red toggle`.
  - Each press turns the simulated event on, or off again.
  - They're local tests: they never touch the live race data.
  - They follow the same rules as live events: Automatic and Test modes show them, Manual and Disabled don't.
  - They end on their own after 5 minutes (`testEventMaxMs`).
  - The flag rules are off until their source in the collector is verified. A flag test notifies you that no enabled
    rule follows it, until you turn the rule on under **Lighting Control > Configuration**.
  - Restore Baseline ends every test at once.
- **Restore Defaults:** Automatic mode, the start scene, no manual changes, the configured brightness.
- **Status:** the notification described under Setting it up.
- **Lighting Page:** the agent's local page in the browser.

`racingcoach-lighting streamdeck list` prints the layout with your own zones. The Admin page's **Stream Deck** tab shows
it with the default zones. Both come from `src/lib/lighting/streamDeckLayout.ts`, which the agent's tests check: 32
keys, one per position, and every command one the agent accepts.

## Latency

A key press takes:

- the applet starting: about 0.2–0.5 s;
- the command's Node start: about 0.1–0.2 s;
- the agent's change to the controller: tens of ms (README, Measured latency).

That's fine for scenes and modes. Racing events never go through a key; they arrive over the agent's own connection.

## Native plugin: evaluation

The official Elgato Stream Deck SDK (Node.js, `@elgato/streamdeck`) would make a RacingCoach plugin with:

- **Dynamic key colors and titles** (`setImage`, `setTitle`, `setState`). For example, the active scene's key is lit,
  the mode keys show which mode is on, and the Pit Limiter Test key turns blue while a test is on.
- **Connection status on a key.** It would show the agent unreachable, the site disconnected or a controller offline,
  through an alert or a status key.
- **Real-time state synchronization.** The plugin would hold one connection to the agent instead of starting a process
  per press. The agent would need a push channel for this: Server-Sent Events from `GET /events` on the local API,
  token-checked like the rest.
- **Settings in Stream Deck's property inspector:** which scene, zone or color a key controls, chosen from the
  agent's configuration, instead of rebuilding the apps.
- **Faster presses.** There's no applet or Node start, only a request on a connection that's already open.

What it costs:

- A plugin is its own project: a manifest, the plugin code, property inspector HTML and an icon set. It's packaged
  with Elgato's CLI as a `.streamDeckPlugin` file and installed on the Mac by hand, or published to the Marketplace.
- It needs the agent's local API to gain an event stream and probably a `/config` read endpoint.
- It must be kept working across Stream Deck app updates (the SDK's minimum app version).

Recommendation: keep the button apps until the hardware is installed and the pit limiter is proven on the real
lights. Then build the plugin in this order:

1. The agent's local event stream.
2. A plugin with three actions (Scene, Zone, Mode) that light up with the state.
3. The test and status actions.

The button apps stay as the fallback; they need nothing but the agent.
