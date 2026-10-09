(() => {
  const nav = document.querySelector("[data-nav]");
  if (nav) {
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const demo = document.querySelector("[data-demo]");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!demo || still || !("IntersectionObserver" in window)) return;

  const holds = [500, 1400, 2200, 1800, 3600];
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
