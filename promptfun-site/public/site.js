(() => {
  const copyMcp = document.querySelector("[data-copy-mcp]");
  const mcpUrl = document.getElementById("mcp-url");
  if (copyMcp && mcpUrl) {
    copyMcp.addEventListener("click", async () => {
      const text = mcpUrl.textContent.trim();
      try {
        await navigator.clipboard.writeText(text);
        copyMcp.textContent = "Copied";
        setTimeout(() => { copyMcp.textContent = "Copy"; }, 2000);
      } catch {
        copyMcp.textContent = "Copy failed";
        setTimeout(() => { copyMcp.textContent = "Copy"; }, 2000);
      }
    });
  }

  const nav = document.querySelector("[data-nav]");
  if (nav) {
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
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
