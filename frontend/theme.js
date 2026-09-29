(() => {
  const key = "companies-theme";
  const mediaQuery = matchMedia("(prefers-color-scheme: dark)");
  const options = {
    light: ["☀️", "Light"],
    dark: ["🌙", "Dark"],
    system: ["🖥", "System"],
  };
  const getChoice = () => localStorage.getItem(key) || localStorage.getItem("company-explorer-theme") || "system";
  const resolveTheme = (choice) => choice === "system" ? (mediaQuery.matches ? "dark" : "light") : choice;
  const apply = (choice) => {
    document.documentElement.dataset.theme = resolveTheme(choice);
    const icon = document.querySelector(".global-theme-menu .theme-icon");
    const label = document.querySelector(".global-theme-menu .theme-label");
    if (icon) icon.textContent = options[choice][0];
    if (label) label.textContent = options[choice][1];
    document.querySelectorAll("[data-theme-choice]").forEach((item) => {
      item.classList.toggle("active", item.dataset.themeChoice === choice);
    });
  };
  apply(getChoice());
  mediaQuery.addEventListener("change", () => {
    if (getChoice() === "system") apply("system");
  });
  addEventListener("company-theme-change", (event) => {
    apply(event.detail || getChoice());
  });
  addEventListener("DOMContentLoaded", () => {
    let menu = document.querySelector(".global-theme-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "global-theme-menu";
      menu.innerHTML = '<button class="global-theme-button" type="button" aria-haspopup="true" aria-expanded="false"><span class="theme-icon"></span><span class="theme-label"></span></button><div class="global-theme-options"><button type="button" data-theme-choice="light">☀️ Light</button><button type="button" data-theme-choice="dark">🌙 Dark</button><button type="button" data-theme-choice="system">🖥 System</button></div>';
      document.body.append(menu);
    }
    const button = menu.querySelector(".global-theme-button");
    const dropdown = menu.querySelector(".global-theme-options");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = menu.classList.toggle("open");
      button.setAttribute("aria-expanded", String(open));
    });
    menu.querySelectorAll("[data-theme-choice]").forEach((item) => item.addEventListener("click", () => {
      localStorage.setItem(key, item.dataset.themeChoice);
      apply(item.dataset.themeChoice);
      menu.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    }));
    document.addEventListener("click", () => {
      menu.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    });
    apply(getChoice());
  });
})();
