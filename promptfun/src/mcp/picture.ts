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

const htmlCache = new Map<string, string>();

export function pictureHtml(publicUrl: string): string {
  const origin = new URL(publicUrl).origin;
  const hit = htmlCache.get(origin);
  if (hit) return hit;
  const css = pictureCss();
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head>
<body><div class="pic-wrap"><article class="pic-card" id="root"><p class="pic-title">Coin picture</p>
<p class="pic-sub">JPEG or PNG, up to 15&nbsp;MB. Large photos are compressed for upload; EXIF is stripped.</p>
<img class="pic-preview" id="preview" alt="" hidden>
<div class="pic-actions">
<button type="button" class="btn btn-main" id="pick">Choose image</button>
<button type="button" class="btn btn-ghost" id="useChat" hidden>Use this image</button>
<button type="button" class="btn btn-ghost" id="save" disabled>Save to promptfun</button>
</div>
<p class="pic-err" id="err" hidden></p>
<p class="pic-foot">${BRAND} stores the image until you launch or it expires. Nothing is sent on chain until you confirm a launch.</p>
</article></div>
<input type="file" id="file" accept="image/jpeg,image/png" hidden>
<script>
(function(){
  var MAX = ${15 * 1024 * 1024};
  var nextId = 1, pending = {}, dataUrl = null, pictureId = null, chatImageUrl = null;
  var preview = document.getElementById("preview");
  var errEl = document.getElementById("err");
  var saveBtn = document.getElementById("save");
  var useChatBtn = document.getElementById("useChat");
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
  var uploadOrigin = ${JSON.stringify(origin)};
  var SAFE = 3.2 * 1024 * 1024;
  function compressForProxy(file){
    if (file.size <= SAFE) return Promise.resolve(file);
    return new Promise(function(res, rej){
      var img = new Image();
      img.onload = function(){
        var w = img.naturalWidth, h = img.naturalHeight, scale = Math.min(1, Math.sqrt(SAFE / file.size));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        c.getContext("2d").drawImage(img, 0, 0, cw, ch);
        c.toBlob(function(blob){
          if (!blob) return rej(new Error("Could not compress image."));
          if (blob.size > SAFE && scale > 0.35) {
            c.width = Math.round(cw * 0.75); c.height = Math.round(ch * 0.75);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            c.toBlob(function(b2){ b2 ? res(b2) : rej(new Error("Could not compress image.")); }, "image/jpeg", 0.82);
          } else res(blob);
        }, file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
      };
      img.onerror = function(){ rej(new Error("Could not read image.")); };
      img.src = URL.createObjectURL(file);
    });
  }
  function showSaved(sc){
    pictureId = sc && sc.pictureId;
    if (!pictureId) throw new Error("No picture id returned");
    preview.src = uploadOrigin + "/api/pictures/" + pictureId;
    preview.hidden = false;
    saveBtn.textContent = "Saved";
    saveBtn.disabled = true;
    if (useChatBtn) useChatBtn.hidden = true;
    post({jsonrpc:"2.0", method:"ui/notifications/tool-result", params:{structuredContent: sc}});
    resize();
  }
  function uploadFile(f){
    showErr("");
    saveBtn.disabled = true;
    return compressForProxy(f).then(function(bodyFile){
      var ct = bodyFile.type || f.type || "application/octet-stream";
      return fetch(uploadOrigin + "/api/pictures/upload", {
        method: "POST",
        headers: { "Content-Type": ct },
        body: bodyFile,
      });
    }).then(function(res){
      return res.json().then(function(body){ if (!res.ok) throw new Error(body.error || "Upload failed"); return body; });
    }).then(showSaved)
      .catch(function(e){ showErr((e && e.message) || "Save failed"); saveBtn.disabled = false; });
  }
  saveBtn.onclick = function(){
    var f = document.getElementById("file").files && document.getElementById("file").files[0];
    if (!f) return;
    uploadFile(f);
  };
  useChatBtn.onclick = function(){
    if (!chatImageUrl) return;
    showErr("");
    useChatBtn.disabled = true;
    saveBtn.disabled = true;
    request("tools/call", {name:"import_picture_from_url", arguments:{imageUrl: chatImageUrl}})
      .then(function(res){ showSaved(res && res.structuredContent); })
      .catch(function(e){
        showErr((e && e.message) || "Import failed");
        useChatBtn.disabled = false;
        saveBtn.disabled = !document.getElementById("file").files || !document.getElementById("file").files[0];
      });
  };
  function applyToolOutput(sc){
    if (!sc) return;
    if (sc.sourceImageUrl) {
      chatImageUrl = sc.sourceImageUrl;
      useChatBtn.hidden = false;
      resize();
    }
    if (sc.pictureId) showSaved(sc);
  }
  window.addEventListener("message", function(e){
    var m = e.data; if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && pending[m.id] && !m.method) {
      var q = pending[m.id]; delete pending[m.id];
      m.error ? q.rej(m.error) : q.res(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") applyToolOutput(m.params && m.params.structuredContent);
  });
  request("ui/initialize", {protocolVersion:"2026-01-26", appInfo:{name:"${BRAND} picture", version:"${VERSION}"}, appCapabilities:{availableDisplayModes:["inline"]}})
    .then(function(){ post({jsonrpc:"2.0", method:"ui/notifications/initialized", params:{}}); resize(); })
    .catch(function(){});
  if (window.openai && window.openai.toolOutput) applyToolOutput(window.openai.toolOutput);
})();
</script></body></html>`;
  htmlCache.set(origin, html);
  return html;
}
