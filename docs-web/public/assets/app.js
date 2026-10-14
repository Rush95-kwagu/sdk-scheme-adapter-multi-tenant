(function () {
  const nav = document.querySelector("nav.side");
  const links = Array.from(document.querySelectorAll("nav.side a.item"));
  const sections = document.querySelectorAll("main .section");
  const search = document.getElementById("doc-search");
  const empty = document.getElementById("nav-empty");
  const crumb = document.getElementById("crumb");
  const pager = document.getElementById("pager");
  const toggle = document.getElementById("nav-toggle");
  const backdrop = document.getElementById("backdrop");
  const pagehead = document.querySelector(".pagehead");

  function closeNav() {
    nav.classList.remove("open");
    backdrop.classList.remove("show");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function openNav() {
    nav.classList.add("open");
    backdrop.classList.add("show");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
  }

  function pageOf(id) {
    const link = links.find((a) => a.getAttribute("href") === "#" + id);
    const group = link && link.closest(".nav-group");
    const summary = group && group.querySelector("summary");
    return {
      id,
      title: link ? link.textContent.trim() : id,
      group: summary ? summary.textContent.trim() : "",
      index: links.indexOf(link),
    };
  }

  function show(id) {
    const target = (id || "").replace(/^#/, "") || "accueil";
    sections.forEach((s) => s.classList.toggle("visible", s.id === target));
    links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + target));
    const page = pageOf(target);
    if (crumb) {
      crumb.textContent = page.group ? page.group + " · " + page.title : page.title;
    }
    const active = links.find((a) => a.classList.contains("active"));
    if (active) {
      const group = active.closest(".nav-group");
      if (group && !group.open) group.open = true;
      active.scrollIntoView({ block: "nearest" });
    }
    if (pager) {
      const prev = links[page.index - 1];
      const next = links[page.index + 1];
      pager.innerHTML =
        '<a class="' + (prev ? "" : "disabled") + '" href="' + (prev ? prev.getAttribute("href") : "#") + '">' +
          '<span class="dir">Précédent</span>' + (prev ? prev.textContent.trim() : "") +
        "</a>" +
        '<a class="next ' + (next ? "" : "disabled") + '" href="' + (next ? next.getAttribute("href") : "#") + '">' +
          '<span class="dir">Suivant</span>' + (next ? next.textContent.trim() : "") +
        "</a>";
    }
    window.scrollTo(0, 0);
    closeNav();
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

  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.classList.contains("item")) return;
    const href = a.getAttribute("href");
    if (!href || href === "#") return;
    const dest = document.getElementById(href.slice(1));
    if (!dest || !dest.classList.contains("section")) return;
    e.preventDefault();
    history.replaceState(null, "", href);
    show(href);
  });

  window.addEventListener("hashchange", () => show(location.hash));

  if (search) {
    const filter = () => {
      const q = search.value.trim().toLowerCase();
      let n = 0;
      links.forEach((a) => {
        const hit = !q || a.textContent.toLowerCase().includes(q);
        a.classList.toggle("hidden", !hit);
        if (hit) n += 1;
      });
      document.querySelectorAll(".nav-group").forEach((g) => {
        const any = Array.from(g.querySelectorAll("a.item")).some((a) => !a.classList.contains("hidden"));
        g.style.display = q && !any ? "none" : "";
        if (q && any) g.open = true;
      });
      if (empty) empty.classList.toggle("show", n === 0);
    };
    search.addEventListener("input", filter);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== search) {
      e.preventDefault();
      search && search.focus();
    }
    if (e.key === "Escape") {
      if (document.activeElement === search) search.blur();
      closeNav();
    }
  });

  if (toggle) {
    toggle.addEventListener("click", () => {
      nav.classList.contains("open") ? closeNav() : openNav();
    });
  }
  if (backdrop) backdrop.addEventListener("click", closeNav);

  document.querySelectorAll("main table").forEach((table) => {
    if (table.parentElement.classList.contains("table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  document.querySelectorAll("main pre").forEach((pre) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "Copier";
    btn.addEventListener("click", async () => {
      const text = pre.innerText.replace(/^Copier\n?/, "").replace(/^Copié\n?/, "");
      try {
        await navigator.clipboard.writeText(pre.querySelector("code") ? pre.querySelector("code").innerText : text);
        btn.textContent = "Copié";
        setTimeout(() => { btn.textContent = "Copier"; }, 1400);
      } catch (_) {}
    });
    pre.appendChild(btn);
  });

  window.addEventListener("scroll", () => {
    if (pagehead) pagehead.classList.toggle("is-stuck", window.scrollY > 8);
  }, { passive: true });

  show(location.hash || "#accueil");
})();
