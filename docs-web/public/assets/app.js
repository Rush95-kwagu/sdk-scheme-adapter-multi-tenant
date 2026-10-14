(function () {
  const links = document.querySelectorAll("nav.side a.item");
  const sections = document.querySelectorAll("main .section");

  function show(id) {
    const target = id.replace(/^#/, "") || "accueil";
    sections.forEach((s) => s.classList.toggle("visible", s.id === target));
    links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + target));
    const el = document.getElementById(target);
    if (el) window.scrollTo(0, 0);
  }

  links.forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (href && href.startsWith("#")) {
        e.preventDefault();
        history.replaceState(null, "", href);
        show(href);
      }
    });
  });

  window.addEventListener("hashchange", () => show(location.hash));
  show(location.hash || "#accueil");
})();
