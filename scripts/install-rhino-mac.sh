#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PACKAGE_NAME="hoppercode"
DEFAULT_YAK="/Applications/Rhino 8.app/Contents/Resources/bin/yak"
YAK="${HOPPER_YAK:-$DEFAULT_YAK}"
ASSUME_YES=0
OPEN_RHINO=0
BUILD_ONLY=0

usage() {
	cat <<'EOF'
Build and install the local Hopper Rhino package on macOS.

Requires macOS arm64, Rhino 8.20 or newer running .NET 8, stable Node 22.19.0 or newer, pnpm, and the .NET 8 SDK.
The Yak package does not bundle Node.
HopperCode validates the Node executable and version when Rhino starts Hopper.

Usage:
  ./scripts/install-rhino-mac.sh [options]

Options:
  --yes         Reinstall an existing hoppercode package without prompting.
  --open-rhino  Open Rhino 8 after installation.
  --build-only  Build and smoke-test without installing or stopping the host.
  -h, --help    Show this help.

Rhino must be fully quit before installation. --build-only can run while Rhino is open.
EOF
}

fail() {
	echo "[hoppercode] $*" >&2
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
		--build-only)
			BUILD_ONLY=1
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

[[ "$BUILD_ONLY" -ne 1 || "$OPEN_RHINO" -ne 1 ]] || fail "--build-only cannot be combined with --open-rhino."

[[ "$(uname -s)" == "Darwin" ]] || fail "This installer only supports macOS."
[[ -x "$YAK" ]] || fail "Rhino 8 Yak was not found at $YAK"

require_command node
require_command pnpm
require_command dotnet
require_command pgrep

if [[ "$BUILD_ONLY" -ne 1 ]] && pgrep -x "Rhinoceros" >/dev/null 2>&1; then
	fail "Rhino is running. Quit Rhino fully, then run this script again."
fi

cd "$PROJECT_ROOT"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
ARTIFACT_ROOT="$PROJECT_ROOT/artifacts"
mkdir -p "$ARTIFACT_ROOT"
STAGE_DIR="$(mktemp -d "$ARTIFACT_ROOT/${PACKAGE_NAME}-${PACKAGE_VERSION}-local.XXXXXX")"

echo "[hoppercode] Installing JavaScript dependencies"
HOPPER_SKIP_GH_PLUGIN=1 pnpm install --frozen-lockfile

echo "[hoppercode] Building a fresh Rhino package at $STAGE_DIR"
pnpm build --target mac-arm64 --output "$STAGE_DIR"

echo "[hoppercode] Smoke-testing packaged host imports and native ZeroMQ"
node scripts/smoke-staged-host.mjs "$STAGE_DIR"

if [[ "$BUILD_ONLY" -eq 1 ]]; then
	echo "[hoppercode] Build and smoke test passed. Package files: $STAGE_DIR"
	exit 0
fi

INSTALLED_LINE="$("$YAK" list | awk -v name="$PACKAGE_NAME" '$1 == name || $1 == "hopper-pi" { print }')"
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
				echo "[hoppercode] Installation cancelled. The package remains at $STAGE_DIR"
				exit 0
				;;
		esac
	fi
fi

# Building can take several minutes; check again before touching the installation.
if pgrep -x "Rhinoceros" >/dev/null 2>&1; then
	fail "Rhino was opened during the build. Quit Rhino fully, then run this script again."
fi
node scripts/stop-shared-host.mjs

if [[ -n "$INSTALLED_LINE" ]]; then
	while read -r installed_name _; do
		echo "[hoppercode] Removing the installed $installed_name package"
		"$YAK" uninstall "$installed_name"
	done <<< "$INSTALLED_LINE"
fi

echo "[hoppercode] Installing $PACKAGE_NAME $PACKAGE_VERSION from the local package folder"
"$YAK" install --source="$STAGE_DIR" "$PACKAGE_NAME" "$PACKAGE_VERSION"

if ! "$YAK" list | grep -Fq "$PACKAGE_NAME ($PACKAGE_VERSION)"; then
	fail "Yak did not report $PACKAGE_NAME $PACKAGE_VERSION as installed."
fi

echo
echo "[hoppercode] Installed $PACKAGE_NAME $PACKAGE_VERSION"
echo "[hoppercode] Package files: $STAGE_DIR"
echo "[hoppercode] HopperCode will start a fresh background host using this installation."
echo "[hoppercode] In Rhino, run HopperCode. Grasshopper loads only when the first gh_* tool needs it."

if [[ "$OPEN_RHINO" -eq 1 ]]; then
	echo "[hoppercode] Opening Rhino 8"
	open "/Applications/Rhino 8.app"
fi
