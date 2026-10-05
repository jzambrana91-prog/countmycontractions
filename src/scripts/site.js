const themeKey = "cmc-theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f7f1ea" : "#1a1412");
  const button = document.querySelector("[data-theme-toggle]");
  if (!(button instanceof HTMLButtonElement)) return;
  const dark = theme !== "light";
  button.setAttribute("aria-pressed", dark ? "false" : "true");
  button.textContent = dark ? "Light mode" : "Dark mode";
  button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

function initTheme() {
  const button = document.querySelector("[data-theme-toggle]");
  if (!(button instanceof HTMLButtonElement)) return;
  applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  button.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(themeKey, next);
    } catch {
      /* Storage can be blocked. The toggle still works for this visit. */
    }
    applyTheme(next);
  });
}

function initNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  if (!(toggle instanceof HTMLButtonElement) || !(nav instanceof HTMLElement)) return;

  const setOpen = (open) => {
    nav.dataset.open = open ? "true" : "false";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };

  toggle.addEventListener("click", () => {
    const open = nav.dataset.open !== "true";
    setOpen(open);
    if (open) nav.querySelector("a")?.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      if (nav.dataset.open === "false") toggle.focus();
    }
  });

  nav.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement && window.matchMedia("(max-width: 1079px)").matches) {
      setOpen(false);
    }
  });
}

function initSheetPrint() {
  const button = document.querySelector("[data-print-sheet]");
  if (!(button instanceof HTMLButtonElement)) return;
  button.addEventListener("click", () => {
    document.body.dataset.print = "sheet";
    const cleanup = () => {
      delete document.body.dataset.print;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  });
}

function initServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Offline support is optional if registration fails. */
    });
  });
}

initTheme();
initNav();
initSheetPrint();
initServiceWorker();
