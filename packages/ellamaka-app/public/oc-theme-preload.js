;(function () {
  var key = "opencode-theme-id"
  var themeId = localStorage.getItem(key) || "oc-2"

  if (themeId === "oc-1") {
    themeId = "oc-2"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("opencode-theme-css-light")
    localStorage.removeItem("opencode-theme-css-dark")
  }

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  // Preload UI font sizes to prevent FOUT / layout shift on reload
  try {
    var rawSettings = localStorage.getItem("opencode.settings.v3") || localStorage.getItem("settings.v3")
    if (rawSettings) {
      var settingsData = JSON.parse(rawSettings)
      if (settingsData && settingsData.appearance && settingsData.appearance.fontSize) {
        var baseSize = settingsData.appearance.fontSize
        var root = document.documentElement
        root.style.setProperty("--ui-font-size-base", baseSize + "px")
        root.style.setProperty("--font-size-base", baseSize + "px")
        root.style.setProperty("--font-size-small", Math.max(12, Math.round(baseSize * 0.93)) + "px")
        root.style.setProperty("--font-size-large", Math.round(baseSize * 1.14) + "px")
        root.style.setProperty("--font-size-x-large", Math.round(baseSize * 1.35) + "px")
      } else {
        var baseSize = 15
        var root = document.documentElement
        root.style.setProperty("--ui-font-size-base", baseSize + "px")
        root.style.setProperty("--font-size-base", baseSize + "px")
        root.style.setProperty("--font-size-small", Math.max(12, Math.round(baseSize * 0.93)) + "px")
        root.style.setProperty("--font-size-large", Math.round(baseSize * 1.14) + "px")
        root.style.setProperty("--font-size-x-large", Math.round(baseSize * 1.35) + "px")
      }
    }
  } catch (e) {}

  if (themeId === "oc-2") return

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
