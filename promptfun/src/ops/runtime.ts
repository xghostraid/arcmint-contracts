/** In-memory ops override; env kill switch still wins when set. */
let sponsorPausedByOps = false;

export function setRuntimeSponsorPaused(paused: boolean): void {
  sponsorPausedByOps = paused;
}

export function isRuntimeSponsorPaused(): boolean {
  return sponsorPausedByOps;
}

export function resetRuntimeOpsForTests(): void {
  sponsorPausedByOps = false;
}
