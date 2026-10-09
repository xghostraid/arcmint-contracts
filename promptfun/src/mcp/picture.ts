import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND, VERSION } from "../brand.js";

export const PICTURE_URI = "ui://promptfun/picture-v1.html";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = [path.resolve(here, "../../public"), path.resolve(here, "../../../public")].find((dir) => fs.existsSync(dir))!;

function pictureCss(): string {
  const sunny = fs.readFileSync(path.join(PUBLIC_DIR, "sunny-pop.css"), "utf8");
  const panel = fs.readFileSync(path.join(PUBLIC_DIR, "picture.css"), "utf8").replace('@import url("sunny-pop.css");\n', "");
  const font = fs.readFileSync(path.join(PUBLIC_DIR, "fonts/instrument-sans.woff2"));
  const fontUri = `data:font/woff2;base64,${font.toString("base64")}`;
  return `${sunny}\n${panel}`.replace(/url\("fonts\/instrument-sans\.woff2"\)/g, `url("${fontUri}")`);
}

let cached: string | null = null;

export function pictureHtml(): string {
  if (cached) return cached;
  const css = pictureCss();
  cached = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head>
<body><div class="pic-wrap"><article class="pic-card" id="root"><p class="pic-title">Coin picture</p>
<p class="pic-sub">JPEG or PNG, up to 15&nbsp;MB. EXIF is stripped before upload.</p>
<img class="pic-preview" id="preview" alt="" hidden>
<div class="pic-actions">
<button type="button" class="btn btn-main" id="pick">Choose image</button>
<button type="button" class="btn btn-ghost" id="save" disabled>Save to promptfun</button>
</div>
<p class="pic-err" id="err" hidden></p>
<p class="pic-foot">${BRAND} stores the image until you launch or it expires. Nothing is sent on chain until you confirm a launch.</p>
</article></div>
<input type="file" id="file" accept="image/jpeg,image/png" hidden>
<script>
(function(){
  var MAX = ${15 * 1024 * 1024};
  var nextId = 1, pending = {}, dataUrl = null, pictureId = null;
  var preview = document.getElementById("preview");
  var errEl = document.getElementById("err");
  var saveBtn = document.getElementById("save");
  function post(m){ window.parent.postMessage(m, "*"); }
  function request(method, params){ var id = nextId++; post({jsonrpc:"2.0", id:id, method:method, params:params}); return new Promise(function(res, rej){ pending[id] = {res:res, rej:rej}; }); }
  function showErr(msg){ errEl.hidden = !msg; errEl.textContent = msg || ""; }
  function resize(){
    post({jsonrpc:"2.0", method:"ui/notifications/size-changed", params:{height:document.documentElement.scrollHeight}});
  }
  document.getElementById("pick").onclick = function(){ document.getElementById("file").click(); };
  document.getElementById("file").onchange = function(e){
    showErr("");
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > MAX) { showErr("Image is over 15 MB."); return; }
    var r = new FileReader();
    r.onload = function(){
      dataUrl = r.result;
      preview.src = dataUrl;
      preview.hidden = false;
      saveBtn.disabled = false;
      pictureId = null;
      resize();
    };
    r.readAsDataURL(f);
  };
  saveBtn.onclick = function(){
    if (!dataUrl) return;
    showErr("");
    saveBtn.disabled = true;
    request("tools/call", {name:"save_picture", arguments:{imageBase64: dataUrl}})
      .then(function(res){
        var sc = res && res.structuredContent;
        pictureId = sc && sc.pictureId;
        if (!pictureId) throw new Error("No picture id returned");
        saveBtn.textContent = "Saved";
        post({jsonrpc:"2.0", method:"ui/notifications/tool-result", params:{structuredContent: sc}});
        resize();
      })
      .catch(function(e){ showErr((e && e.message) || "Save failed"); saveBtn.disabled = false; });
  };
  window.addEventListener("message", function(e){
    var m = e.data; if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && pending[m.id] && !m.method) {
      var q = pending[m.id]; delete pending[m.id];
      m.error ? q.rej(m.error) : q.res(m.result);
    }
  });
  request("ui/initialize", {protocolVersion:"2026-01-26", appInfo:{name:"${BRAND} picture", version:"${VERSION}"}, appCapabilities:{availableDisplayModes:["inline"]}})
    .then(function(){ post({jsonrpc:"2.0", method:"ui/notifications/initialized", params:{}}); resize(); })
    .catch(function(){});
})();
</script></body></html>`;
  return cached;
}
