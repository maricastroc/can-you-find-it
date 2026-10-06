#!/usr/bin/env bash
# Create a locally-trusted certificate for this computer's LAN addresses, so a
# phone on the same network can use the live camera (browsers require HTTPS).
# Needs mkcert: brew install mkcert && mkcert -install
set -euo pipefail
command -v mkcert >/dev/null || { echo "Install mkcert first: brew install mkcert && mkcert -install"; exit 1; }
mkdir -p certificates
names=(localhost 127.0.0.1 "$(scutil --get LocalHostName 2>/dev/null || hostname -s).local")
for ip in $(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2}'); do names+=("$ip"); done
mkcert -cert-file certificates/cert.pem -key-file certificates/key.pem "${names[@]}"
echo
echo "Now trust mkcert's root certificate on the phone:"
echo "  1. AirDrop or email this file to the phone: $(mkcert -CAROOT)/rootCA.pem"
echo "  2. iPhone: Settings → Profile Downloaded → Install"
echo "  3. iPhone: Settings → General → About → Certificate Trust Settings → enable it"
