import assert from "node:assert/strict";
import { test } from "node:test";
import { explainSimulationFailure } from "../../src/chains/solana/adapter.js";

test("a system transfer short of lamports is explained in SOL", () => {
  const logs = [
    "Program 11111111111111111111111111111111 invoke [1]",
    "Transfer: insufficient lamports 7998980000, need 500000000000",
    "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
  ];
  assert.equal(explainSimulationFailure(logs, { InstructionError: [0, { Custom: 1 }] }), "Not enough SOL: the wallet has 7.99898 SOL but this needs 500 SOL");
});

test("an unfunded fee payer is explained", () => {
  assert.equal(explainSimulationFailure([], "AccountNotFound"), "Not enough SOL: the wallet has no SOL on this network yet");
});

test("an unknown failure falls back to the program's last error line", () => {
  const logs = ["Program X invoke [1]", "Program X failed: custom program error: 0x7"];
  assert.equal(explainSimulationFailure(logs, {}), "Program X failed: custom program error: 0x7");
});
