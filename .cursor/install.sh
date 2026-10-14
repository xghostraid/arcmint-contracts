#!/usr/bin/env bash
# Idempotent bootstrap for the arcmint-contracts Foundry project.
# Installs the Foundry toolchain (pinned), fetches Solidity dependencies into
# the gitignored lib/ directory, and compiles to validate + warm the cache.
set -euo pipefail

FOUNDRY_VERSION="1.8.1"
FORGE_STD_VERSION="v1.16.2"
OPENZEPPELIN_VERSION="v5.1.0"

FOUNDRY_BIN="${HOME}/.foundry/bin"
export PATH="${FOUNDRY_BIN}:${PATH}"

# 1. Foundry toolchain (forge/cast/anvil). Pinned for reproducible builds.
if ! command -v forge >/dev/null 2>&1; then
  echo "Installing Foundry ${FOUNDRY_VERSION}..."
  curl -L https://foundry.paradigm.xyz | bash
  "${FOUNDRY_BIN}/foundryup" -i "${FOUNDRY_VERSION}"
fi

# Expose the toolchain on PATH for every future (login/non-login) shell.
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  for bin in forge cast anvil chisel; do
    sudo ln -sf "${FOUNDRY_BIN}/${bin}" "/usr/local/bin/${bin}"
  done
fi

echo "forge: $(forge --version | head -n1)"

# 2. Solidity dependencies. lib/ is gitignored, so fetch on a fresh checkout.
if [ ! -d lib/forge-std ]; then
  forge install --no-git "foundry-rs/forge-std@${FORGE_STD_VERSION}"
fi
if [ ! -d lib/openzeppelin-contracts ]; then
  forge install --no-git "OpenZeppelin/openzeppelin-contracts@${OPENZEPPELIN_VERSION}"
fi

# 3. Compile to validate the toolchain + dependencies and warm the build cache.
forge build

echo "arcmint-contracts environment ready."
