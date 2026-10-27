#!/bin/bash
# Distribution gate; does not install, execute, or upload the APK.
set -euo pipefail
apk=${1:?Usage: verify-release.sh APK VERSION_CODE VERSION_NAME}
code=${2:?Version code required}
name=${3:?Version name required}
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}
build_tools="$sdk/build-tools/36.1.0"
cert="$($build_tools/apksigner verify --verbose --print-certs "$apk")"
expected=027555e7a8662d3029c1c29112723855d40c490e17ea4410985d783ea78a3d19
[[ "$cert" == *"Signer #1 certificate SHA-256 digest: $expected"* ]]
[[ "$cert" == *"Number of signers: 1"* ]]
badging="$($build_tools/aapt dump badging "$apk")"
[[ "$badging" == *"package: name='kr.swim.phone' versionCode='$code' versionName='$name'"* ]]
if [[ "$badging" == *application-debuggable* ]]; then echo 'REFUSED: debuggable APK'; exit 1; fi
manifest="$($build_tools/aapt dump xmltree "$apk" AndroidManifest.xml)"
if echo "$manifest" | /usr/bin/grep -E 'android:(debuggable|testOnly).*0xffffffff'; then echo 'REFUSED: debug/test APK'; exit 1; fi
echo "PASS: original signer, package, version $name ($code), non-debug/non-test APK"
shasum -a 256 "$apk"
