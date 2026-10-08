const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t" };

export function impersonatesPromptfun(value) {
  const raw = String(value ?? "").toLowerCase();
  let folded = "";
  for (const ch of raw) {
    if (LEET[ch]) folded += LEET[ch];
    else if (ch >= "a" && ch <= "z") folded += ch;
  }
  return folded.includes("promptfun");
}
