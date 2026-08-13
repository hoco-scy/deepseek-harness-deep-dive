(() => {
  const root = document.documentElement.dataset.root || "";
  const pageSlug = document.body.dataset.page;
  const baseline = document.body.dataset.baseline;
  const storageKey = `dpsk-harness-analysis:${baseline}:${pageSlug}:notes`;

  const navToggle = document.querySelector("[data-nav-toggle]");
  const sidebar = document.querySelector("[data-sidebar]");
  navToggle?.addEventListener("click", () => {
    const open = sidebar?.classList.toggle("open") ?? false;
    navToggle.setAttribute("aria-expanded", String(open));
  });

  const filter = document.querySelector("[data-chapter-filter]");
  filter?.addEventListener("input", () => {
    const query = filter.value.trim().toLocaleLowerCase("zh-CN");
    document.querySelectorAll("[data-chapter-item]").forEach((item) => {
      const haystack = item.textContent.toLocaleLowerCase("zh-CN");
      item.hidden = query.length > 0 && !haystack.includes(query);
    });
    document.querySelectorAll("[data-part]").forEach((part) => {
      const visible = [...part.querySelectorAll("[data-chapter-item]")].some((item) => !item.hidden);
      part.hidden = !visible;
    });
  });

  const jump = document.querySelector("[data-chapter-jump]");
  jump?.addEventListener("change", () => {
    if (jump.value) window.location.href = `${root}pages/${jump.value}.html`;
  });

  const article = document.querySelector("[data-article]");
  const toc = document.querySelector("[data-toc]");
  if (article && toc) {
    const headings = [...article.querySelectorAll("h2, h3")];
    const used = new Map();
    for (const heading of headings) {
      const base = heading.textContent
        .trim()
        .toLocaleLowerCase("zh-CN")
        .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
        .replace(/^-|-$/g, "") || "section";
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      heading.id ||= count === 0 ? base : `${base}-${count + 1}`;
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      link.className = heading.tagName === "H3" ? "toc-sub" : "";
      toc.append(link);
    }
  }

  const textarea = document.querySelector("[data-learning-notes]");
  const saved = document.querySelector("[data-note-saved]");
  const count = document.querySelector("[data-note-count]");
  let saveTimer;

  const updateCount = () => {
    if (count && textarea) count.textContent = `${textarea.value.length} 字符`;
  };

  if (textarea) {
    try {
      textarea.value = localStorage.getItem(storageKey) || "";
    } catch {
      textarea.placeholder = "浏览器禁止本地存储；可以书写，但刷新后不会保留。";
    }
    updateCount();
    textarea.addEventListener("input", () => {
      updateCount();
      if (saved) saved.textContent = "尚未保存";
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, textarea.value);
          if (saved) saved.textContent = `已保存于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
        } catch {
          if (saved) saved.textContent = "本地存储不可用";
        }
      }, 350);
    });
  }

  document.querySelector("[data-note-export]")?.addEventListener("click", () => {
    const title = document.querySelector("h1")?.textContent || pageSlug;
    const body = `# ${title} — 我的学习体会\n\n基线：${baseline}\n导出时间：${new Date().toISOString()}\n\n${textarea?.value || ""}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${pageSlug}-notes.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector("[data-note-clear]")?.addEventListener("click", () => {
    if (!textarea || !textarea.value || !window.confirm("清空本页学习体会？此操作无法撤销。")) return;
    textarea.value = "";
    try { localStorage.removeItem(storageKey); } catch { /* local-only best effort */ }
    if (saved) saved.textContent = "已清空";
    updateCount();
  });

  const themeButton = document.querySelector("[data-theme-toggle]");
  let theme;
  try { theme = localStorage.getItem("dpsk-harness-analysis:theme"); } catch { /* optional */ }
  if (theme) document.documentElement.dataset.theme = theme;
  themeButton?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("dpsk-harness-analysis:theme", next); } catch { /* optional */ }
  });
})();
