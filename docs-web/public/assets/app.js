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
  const tocNav = document.getElementById("page-toc-nav");
  const tocRoot = document.getElementById("page-toc");
  let tocObserver = null;

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

  function slugify(text) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "titre";
  }

  function headingLabel(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function tocHeadings(section) {
    return Array.from(section.querySelectorAll("h2, h3, h4")).filter((h) => {
      if (h.closest(".card")) return false;
      if (h.closest(".page-toc")) return false;
      return true;
    });
  }

  function ensureHeadingIds(section) {
    const used = new Set();
    tocHeadings(section).forEach((h, i) => {
      if (h.id && h.id !== section.id) {
        used.add(h.id);
        return;
      }
      let base = section.id + "--" + slugify(headingLabel(h) || "s" + (i + 1));
      let id = base;
      let n = 2;
      while (used.has(id) || document.getElementById(id)) {
        id = base + "-" + n;
        n += 1;
      }
      h.id = id;
      used.add(id);
    });
  }

  function buildToc(section) {
    if (!tocNav) return;
    tocNav.innerHTML = "";
    const heads = tocHeadings(section);
    const firstH2 = heads.find((h) => h.tagName === "H2");
    const rest = heads.filter((h) => h !== firstH2);
    const items = rest.length ? rest : heads;
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "toc-empty";
      p.textContent = "Pas de sous-rubrique.";
      tocNav.appendChild(p);
      if (tocRoot) tocRoot.hidden = false;
      return;
    }
    let major = 0;
    let minor = 0;
    items.forEach((h) => {
      const a = document.createElement("a");
      a.href = "#" + h.id;
      if (h.tagName === "H2" || h.tagName === "H3") {
        major += 1;
        minor = 0;
        a.dataset.level = "1";
      } else {
        minor += 1;
        a.dataset.level = "2";
        a.classList.add("sub");
      }
      const num = document.createElement("span");
      num.className = "n";
      num.textContent = a.dataset.level === "2" ? major + "." + minor : major + ".";
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = headingLabel(h);
      a.appendChild(num);
      a.appendChild(t);
      tocNav.appendChild(a);
    });
    if (tocRoot) tocRoot.hidden = false;
    observeToc(items);
  }

  function setTocActive(id) {
    if (!tocNav) return;
    tocNav.querySelectorAll("a").forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === "#" + id);
    });
  }

  function observeToc(heads) {
    if (tocObserver) tocObserver.disconnect();
    if (!heads.length) return;
    tocObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setTocActive(visible[0].target.id);
      },
      { rootMargin: "-18% 0px -70% 0px", threshold: [0, 1] }
    );
    heads.forEach((h) => tocObserver.observe(h));
    setTocActive(heads[0].id);
  }

  function resolveHash(hash) {
    const raw = (hash || "").replace(/^#/, "") || "accueil";
    const el = document.getElementById(raw);
    if (el && el.classList.contains("section")) {
      return { section: raw, heading: null };
    }
    if (el) {
      const sec = el.closest(".section");
      if (sec) return { section: sec.id, heading: el };
    }
    const dash = raw.indexOf("--");
    if (dash > 0) {
      const maybe = raw.slice(0, dash);
      if (document.getElementById(maybe)) return { section: maybe, heading: el };
    }
    return { section: "accueil", heading: null };
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

  function show(id, headingEl) {
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
    const section = document.getElementById(target);
    if (section) {
      ensureHeadingIds(section);
      buildToc(section);
    }
    closeNav();
    if (headingEl) {
      requestAnimationFrame(() => {
        headingEl.scrollIntoView({ block: "start" });
        setTocActive(headingEl.id);
      });
    } else {
      window.scrollTo(0, 0);
    }
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
    if (!dest) return;
    if (dest.classList.contains("section")) {
      e.preventDefault();
      history.replaceState(null, "", href);
      show(href);
      return;
    }
    const sec = dest.closest(".section");
    if (!sec) return;
    e.preventDefault();
    history.replaceState(null, "", href);
    show(sec.id, dest);
  });

  window.addEventListener("hashchange", () => {
    const r = resolveHash(location.hash);
    show(r.section, r.heading);
  });

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

  const initial = resolveHash(location.hash || "#accueil");
  show(initial.section, initial.heading);
})();
