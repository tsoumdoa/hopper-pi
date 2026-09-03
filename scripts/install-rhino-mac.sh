#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PACKAGE_NAME="hopper-pi"
DEFAULT_YAK="/Applications/Rhino 8.app/Contents/Resources/bin/yak"
YAK="${HOPPER_YAK:-$DEFAULT_YAK}"
ASSUME_YES=0
OPEN_RHINO=0

usage() {
	cat <<'EOF'
Build and install the local Hopper Rhino package on macOS.

Requires macOS arm64, Rhino 8, stable Node 22.19.0 or newer, pnpm, and the .NET 7 SDK.
The Yak package does not bundle Node.
HopperCode validates the Node executable and version when Rhino starts Hopper.

Usage:
  ./scripts/install-rhino-mac.sh [options]

Options:
  --yes         Reinstall an existing hopper-pi package without prompting.
  --open-rhino  Open Rhino 8 after installation.
  -h, --help    Show this help.

Rhino must be fully quit before running this script.
EOF
}

fail() {
	echo "[hopper-pi] $*" >&2
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || fail "Required command is missing: $1"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--yes)
			ASSUME_YES=1
			;;
		--open-rhino)
			OPEN_RHINO=1
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			fail "Unknown option: $1"
			;;
	esac
	shift
done

[[ "$(uname -s)" == "Darwin" ]] || fail "This installer only supports macOS."
[[ -x "$YAK" ]] || fail "Rhino 8 Yak was not found at $YAK"

require_command node
require_command pnpm
require_command dotnet
require_command pgrep

if pgrep -x "Rhinoceros" >/dev/null 2>&1; then
	fail "Rhino is running. Quit Rhino fully, then run this script again."
fi

cd "$PROJECT_ROOT"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
ARTIFACT_ROOT="$PROJECT_ROOT/artifacts"
mkdir -p "$ARTIFACT_ROOT"
STAGE_DIR="$(mktemp -d "$ARTIFACT_ROOT/${PACKAGE_NAME}-${PACKAGE_VERSION}-local.XXXXXX")"

echo "[hopper-pi] Installing JavaScript dependencies"
HOPPER_SKIP_GH_PLUGIN=1 pnpm install --frozen-lockfile

echo "[hopper-pi] Building a fresh Rhino package at $STAGE_DIR"
pnpm package:rhino -- --output "$STAGE_DIR" --yak

echo "[hopper-pi] Smoke-testing packaged host imports and native ZeroMQ"
node scripts/smoke-staged-host.mjs "$STAGE_DIR"

INSTALLED_LINE="$("$YAK" list | awk -v name="$PACKAGE_NAME" '$1 == name { print; exit }')"
if [[ -n "$INSTALLED_LINE" ]]; then
	if [[ "$ASSUME_YES" -ne 1 ]]; then
		if [[ ! -t 0 ]]; then
			fail "$INSTALLED_LINE is already installed. Rerun with --yes to replace it."
		fi
		printf '%s is already installed. Replace it? [y/N] ' "$INSTALLED_LINE"
		read -r REPLY
		case "$REPLY" in
			y|Y|yes|YES)
				;;
			*)
				echo "[hopper-pi] Installation cancelled. The package remains at $STAGE_DIR"
				exit 0
				;;
		esac
	fi
	echo "[hopper-pi] Removing the installed $PACKAGE_NAME package"
	"$YAK" uninstall "$PACKAGE_NAME"
fi

echo "[hopper-pi] Installing $PACKAGE_NAME $PACKAGE_VERSION from the local package folder"
"$YAK" install --source="$STAGE_DIR" "$PACKAGE_NAME" "$PACKAGE_VERSION"

if ! "$YAK" list | grep -Fq "$PACKAGE_NAME ($PACKAGE_VERSION)"; then
	fail "Yak did not report $PACKAGE_NAME $PACKAGE_VERSION as installed."
fi

echo
echo "[hopper-pi] Installed $PACKAGE_NAME $PACKAGE_VERSION"
echo "[hopper-pi] Package files: $STAGE_DIR"
echo "[hopper-pi] In Rhino, run HopperCode. Grasshopper loads only when the first gh_* tool needs it."

if [[ "$OPEN_RHINO" -eq 1 ]]; then
	echo "[hopper-pi] Opening Rhino 8"
	open "/Applications/Rhino 8.app"
fi
