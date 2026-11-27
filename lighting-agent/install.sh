#!/bin/bash
# Installs the RacingCoach Lighting Agent on this Mac (docs/lighting/MAC_INSTALL.md):
#   lighting-agent/install.sh            install (or update) and start it
#   lighting-agent/install.sh uninstall  stop it and remove the LaunchAgent and the command (keeps config and logs)
# It links the racingcoach-lighting command into ~/.local/bin (and /usr/local/bin when that's writable), writes the
# LaunchAgent with this repository's path and your Node, and starts it. Nothing here needs sudo.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="app.racingcoach.lighting"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST" "$HOME/.local/bin/racingcoach-lighting"
  [ -L /usr/local/bin/racingcoach-lighting ] && rm -f /usr/local/bin/racingcoach-lighting || true
  echo "Uninstalled. Your configuration and logs are still in ~/Library/Application Support/RacingCoachLighting and ~/Library/Logs/RacingCoachLighting."
  exit 0
fi

if [ -z "$NODE" ]; then echo "Install Node.js 22.18 or later first: brew install node" >&2; exit 1; fi
MAJOR_MINOR="$("$NODE" -p 'process.versions.node.split(".").slice(0,2).join(".")')"
"$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "Node $MAJOR_MINOR is too old: 22.18 or later runs the agent's TypeScript directly (brew upgrade node)" >&2; exit 1; }

chmod +x "$REPO/lighting-agent/bin/racingcoach-lighting"
mkdir -p "$HOME/.local/bin" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/RacingCoachLighting"
ln -sf "$REPO/lighting-agent/bin/racingcoach-lighting" "$HOME/.local/bin/racingcoach-lighting"
if [ -w /usr/local/bin ]; then ln -sf "$REPO/lighting-agent/bin/racingcoach-lighting" /usr/local/bin/racingcoach-lighting; fi

sed -e "s|NODE|$NODE|g" -e "s|REPO|$REPO|g" -e "s|HOME|$HOME|g" "$REPO/lighting-agent/launchd/$LABEL.plist" > "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed and started. Command: $HOME/.local/bin/racingcoach-lighting"
echo "Next: racingcoach-lighting pair   (then approve the code on the website's Admin page, Lighting Control)"
