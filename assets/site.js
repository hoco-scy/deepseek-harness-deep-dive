(() => {
  const root = document.documentElement.dataset.root || "";
  const pageSlug = document.body.dataset.page;
  const baseline = document.body.dataset.baseline;
  const lang = document.body.dataset.lang === "zh" ? "zh" : "en";
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  const messages = lang === "zh" ? {
    chars: "字符", unsaved: "尚未保存", savedAt: "已保存于", unavailable: "本地存储不可用",
    storageBlocked: "浏览器禁止本地存储；可以书写，但刷新后不会保留。", noteHeading: "我的学习体会",
    baseline: "基线", exportedAt: "导出时间", clearConfirm: "清空本页学习体会？此操作无法撤销。", cleared: "已清空",
  } : {
    chars: "characters", unsaved: "Not yet saved", savedAt: "Saved at", unavailable: "Local storage unavailable",
    storageBlocked: "This browser blocks local storage. You can write here, but the note will not survive a refresh.", noteHeading: "My Learning Notes",
    baseline: "Baseline", exportedAt: "Exported at", clearConfirm: "Clear this chapter's learning notes? This cannot be undone.", cleared: "Cleared",
  };
  const storageKey = `dpsk-harness-analysis:${baseline}:${pageSlug}:notes`;

  const navToggle = document.querySelector("[data-nav-toggle]");
  const sidebar = document.querySelector("[data-sidebar]");
  navToggle?.addEventListener("click", () => {
    const open = sidebar?.classList.toggle("open") ?? false;
    navToggle.setAttribute("aria-expanded", String(open));
  });

  const filter = document.querySelector("[data-chapter-filter]");
  filter?.addEventListener("input", () => {
    const query = filter.value.trim().toLocaleLowerCase(locale);
    document.querySelectorAll("[data-chapter-item]").forEach((item) => {
      const haystack = item.textContent.toLocaleLowerCase(locale);
      item.hidden = query.length > 0 && !haystack.includes(query);
    });
    document.querySelectorAll("[data-part]").forEach((part) => {
      part.hidden = ![...part.querySelectorAll("[data-chapter-item]")].some((item) => !item.hidden);
    });
  });

  document.querySelector("[data-chapter-jump]")?.addEventListener("change", (event) => {
    if (event.currentTarget.value) window.location.href = `${root}pages/${event.currentTarget.value}.html`;
  });

  const article = document.querySelector("[data-article]");
  const toc = document.querySelector("[data-toc]");
  if (article && toc) {
    const used = new Map();
    for (const heading of article.querySelectorAll("h2, h3")) {
      const base = heading.textContent.trim().toLocaleLowerCase(locale).replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "") || "section";
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
  const updateCount = () => { if (count && textarea) count.textContent = `${textarea.value.length} ${messages.chars}`; };

  if (textarea) {
    try { textarea.value = localStorage.getItem(storageKey) || ""; }
    catch { textarea.placeholder = messages.storageBlocked; }
    updateCount();
    textarea.addEventListener("input", () => {
      updateCount();
      if (saved) saved.textContent = messages.unsaved;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, textarea.value);
          if (saved) saved.textContent = `${messages.savedAt} ${new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
        } catch { if (saved) saved.textContent = messages.unavailable; }
      }, 350);
    });
  }

  document.querySelector("[data-note-export]")?.addEventListener("click", () => {
    const title = document.querySelector("h1")?.textContent || pageSlug;
    const body = `# ${title} — ${messages.noteHeading}\n\n${messages.baseline}: ${baseline}\n${messages.exportedAt}: ${new Date().toISOString()}\n\n${textarea?.value || ""}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${pageSlug}-notes.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  document.querySelector("[data-note-clear]")?.addEventListener("click", () => {
    if (!textarea || !textarea.value || !window.confirm(messages.clearConfirm)) return;
    textarea.value = "";
    try { localStorage.removeItem(storageKey); } catch { /* local-only best effort */ }
    if (saved) saved.textContent = messages.cleared;
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
