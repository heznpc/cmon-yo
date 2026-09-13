#!/usr/bin/env bash
# Simulator-only ad-hoc entitlements must be embedded by the Xcode build, not
# added to an already-built executable. This enables real Keychain operations.
set -euo pipefail
output="${1:-/tmp/cmon-yo-simulator-build}"
entitlements="$(mktemp /tmp/cmon-yo-simulator-entitlements.XXXXXX)"
cat > "$entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>app.heznpc.cmonyo</string>
<key>keychain-access-groups</key><array><string>app.heznpc.cmonyo</string></array>
</dict></plist>
PLIST
xcodegen generate --spec ios/project.yml
xcodebuild -project ios/CmonYo.xcodeproj -target CmonYo -sdk iphonesimulator \
  -configuration Debug CONFIGURATION_BUILD_DIR="$output" build \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_ENTITLEMENTS="$entitlements"
