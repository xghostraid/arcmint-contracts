(() => {
  const nav = document.querySelector("[data-nav]");
  if (nav) {
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  for (const copyBtn of document.querySelectorAll("[data-copy-mcp]")) {
    const box = copyBtn.closest(".link-box");
    const url = box?.dataset.mcpUrl || box?.querySelector(".link-slot")?.textContent?.trim();
    if (!url) continue;
    copyBtn.addEventListener("click", async () => {
      const label = copyBtn.textContent;
      const ok = async () => {
        await navigator.clipboard.writeText(url);
      };
      try {
        await ok();
      } catch {
        const slot = box.querySelector(".link-slot");
        if (!slot) return;
        const range = document.createRange();
        range.selectNodeContents(slot);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        try {
          document.execCommand("copy");
        } catch {
          return;
        }
        sel?.removeAllRanges();
      }
      copyBtn.textContent = "Copied";
      copyBtn.classList.add("is-copied");
      copyBtn.setAttribute("aria-live", "polite");
      window.setTimeout(() => {
        copyBtn.textContent = label;
        copyBtn.classList.remove("is-copied");
      }, 2000);
    });
  }

  const demo = document.querySelector("[data-demo]");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!demo || still || !("IntersectionObserver" in window)) return;

  const holds = [500, 1200, 1800, 2000, 2400, 3600];
  let stage = 0;
  let timer = null;

  const tick = () => {
    demo.dataset.stage = String(stage);
    timer = setTimeout(() => {
      stage = (stage + 1) % holds.length;
      tick();
    }, holds[stage]);
  };

  demo.classList.add("is-animated");
  demo.dataset.stage = "0";

  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && timer === null) {
      tick();
    } else if (!entry.isIntersecting && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }, { threshold: 0.3 }).observe(demo);
})();
