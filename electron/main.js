const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.loadFile(path.join(__dirname, "..", "ui", "index.html"));
}

ipcMain.handle("save-svg", async (_event, payload) => {
  const svg = typeof payload?.svg === "string" ? payload.svg : "";
  const defaultName = typeof payload?.defaultName === "string" ? payload.defaultName : `plot-${Date.now()}.svg`;

  if (!svg.trim()) {
    return { ok: false, error: "Empty SVG payload." };
  }

  const outputDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outputDir, { recursive: true });

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export SVG",
    defaultPath: path.join(outputDir, defaultName),
    filters: [{ name: "SVG", extensions: ["svg"] }]
  });

  if (canceled || !filePath) {
    return { ok: false, canceled: true };
  }

  fs.writeFileSync(filePath, svg, "utf8");
  return { ok: true, path: filePath };
});

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});