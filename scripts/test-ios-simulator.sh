#!/usr/bin/env bash
# Runs the same contract/HTTP/WebKit XCTest sources as standalone Simulator logic tests.
# Useful when xcodebuild cannot resolve a scheme destination despite an available SDK/runtime.
set -euo pipefail
udid="${1:?Pass an existing booted Simulator UDID}"
qa_root="$(mktemp -d /tmp/cmon-yo-tests.XXXXXX)"
developer_path="$(xcode-select -p)/Platforms/iPhoneSimulator.platform/Developer"
export CMON_QA_ROOT="$qa_root"
python3 - <<'PY'
from pathlib import Path
import os, plistlib, shutil
root = Path(os.environ['CMON_QA_ROOT'])
(root/'sources').mkdir()
(root/'Tests.xctest/fixtures').mkdir(parents=True)
# Only the module import changes: production and XCTest bodies are compiled unchanged.
for p in Path('ios/CmonYoTests').glob('*.swift'):
    (root/'sources'/p.name).write_text(p.read_text().replace('@testable import CmonYo\n', ''))
for p in Path('contracts/fixtures').glob('*.json'):
    shutil.copy2(p, root/'Tests.xctest/fixtures'/p.name)
with (root/'Tests.xctest/Info.plist').open('wb') as f:
    plistlib.dump({'CFBundleIdentifier':'app.heznpc.cmonyo.standalonetests', 'CFBundleExecutable':'Tests', 'CFBundlePackageType':'BNDL'}, f)
PY
xcrun --sdk iphonesimulator swiftc -emit-library -module-name CmonYoTests \
  -target arm64-apple-ios17.0-simulator -swift-version 6 \
  -I "$developer_path/usr/lib" -L "$developer_path/usr/lib" -lXCTestSwiftSupport \
  -F "$developer_path/Library/Frameworks" -framework XCTest \
  -o "$qa_root/Tests.xctest/Tests" ios/CmonYo/Networking/*.swift \
  ios/CmonYo/Web/MeetupBridge.swift "$qa_root"/sources/*.swift
SIMCTL_CHILD_DYLD_FRAMEWORK_PATH="$developer_path/Library/Frameworks" \
SIMCTL_CHILD_DYLD_LIBRARY_PATH="$developer_path/usr/lib" \
xcrun simctl spawn "$udid" "$developer_path/Library/Xcode/Agents/xctest" "$qa_root/Tests.xctest"
