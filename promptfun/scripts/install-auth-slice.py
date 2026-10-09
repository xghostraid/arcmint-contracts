#!/usr/bin/env python3
"""Copy scripts/auth-slice-src into promptfun/src and patch integration points."""
from __future__ import annotations
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
STAGE = ROOT / "scripts" / "auth-slice-src"

def copy_tree(name: str) -> None:
    s, d = STAGE / name, SRC / name
    if s.is_dir():
        if d.exists():
            shutil.rmtree(d)
        shutil.copytree(s, d)

def patch_service(text: str) -> str:
    if "PlatformServices" in text:
        return text
    text = text.replace(
        'import { solanaInstructionFingerprint } from "../sponsor/fingerprint.js";',
        'import { solanaInstructionFingerprint } from "../sponsor/fingerprint.js";\nimport type { PlatformServices } from "../platform/services.js";\nimport type { AuthenticatedUser } from "../auth/types.js";',
    )
    text = text.replace(
        "constructor(readonly config: Config, readonly store: IntentStore) {",
        "private caller: AuthenticatedUser | null = null;\n\n  constructor(readonly config: Config, readonly store: IntentStore, readonly platform: PlatformServices | null = null) {",
    )
    text = text.replace(
        "  sponsorPublicKey(): string | null {",
        "  setCaller(user: AuthenticatedUser | null): void { this.caller = user; }\n  clearCaller(): void { this.caller = null; }\n\n  sponsorPublicKey(): string | null {",
    )
    return text

def main() -> None:
    for d in ("auth", "platform", "wallets", "ops"):
        copy_tree(d)
    cfg = STAGE / "config.ts"
    if cfg.is_file():
        shutil.copy2(cfg, SRC / "config.ts")
    bud = STAGE / "sponsor-budget.ts"
    if bud.is_file():
        shutil.copy2(bud, SRC / "sponsor" / "budget.ts")
    svc = SRC / "intents" / "service.ts"
    svc.write_text(patch_service(svc.read_text()))
    print("installed auth slice from", STAGE)

if __name__ == "__main__":
    main()
