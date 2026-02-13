const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatMinuteTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}${month}${day}-${hour}${minute}`;
}

function defaultExportName(extension) {
  const appName = (app.getName() || "sculpture-generator-desktop").toLowerCase().replace(/[^\w.-]+/g, "-");
  return `${appName}-${formatMinuteTimestamp()}.${extension}`;
}

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
  const defaultName = typeof payload?.defaultName === "string" ? payload.defaultName : defaultExportName("svg");

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

ipcMain.handle("save-stl", async (_event, payload) => {
  const stl = typeof payload?.stl === "string" ? payload.stl : "";
  const defaultName = typeof payload?.defaultName === "string" ? payload.defaultName : defaultExportName("stl");

  if (!stl.trim()) {
    return { ok: false, error: "Empty STL payload." };
  }

  const outputDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outputDir, { recursive: true });

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export STL",
    defaultPath: path.join(outputDir, defaultName),
    filters: [{ name: "STL", extensions: ["stl"] }]
  });

  if (canceled || !filePath) {
    return { ok: false, canceled: true };
  }

  fs.writeFileSync(filePath, stl, "utf8");
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
