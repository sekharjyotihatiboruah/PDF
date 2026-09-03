(async () => {
  "use strict";

  // IMPORTANT: wait for the PDF.js ES module before attaching any PDF logic.
  // Without this, selecting a PDF can fail because window.pdfjsLib is not ready yet.
  try {
    await window.pdfjsReady;
  } catch (err) {
    console.error(err);
    const msg = document.querySelector("#toolMessage");
    if (msg) msg.textContent = "PDF engine could not load. Check your internet connection and reload the page.";
    return;
  }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  let pdfBytes = null;
  let pdfDoc = null;
  let pdfJsDoc = null;
  let currentPage = 1;
  let currentMode = "select";
  let drawing = false;
  let startPoint = null;
  let pageActions = {};
  let history = [];
  let selectedImage = null;

  const fileInput = $("#fileInput");
  const dropzone = $("#dropzone");
  const editorApp = $("#editorApp");
  const landingTool = $("#landingTool");
  const pageSelect = $("#pageSelect");
  const pdfCanvas = $("#pdfCanvas");
  const drawCanvas = $("#drawCanvas");
  const pageStage = $("#pageStage");
  const ctx = drawCanvas.getContext("2d");
  const colorPicker = $("#colorPicker");
  const sizePicker = $("#sizePicker");
  const toolMessage = $("#toolMessage");

  function message(text, error = false) {
    toolMessage.textContent = text;
    toolMessage.style.color = error ? "var(--danger)" : "var(--muted)";
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  function getCanvasPoint(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.width / rect.width;
    const scaleY = drawCanvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function snapshot() {
    history.push(ctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
    if (history.length > 30) history.shift();
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }

  function restoreHistory() {
    const last = history.pop();
    if (last) ctx.putImageData(last, 0, 0);
    else clearCanvas();
  }

  async function openPdf(file) {
    if (!file || (file.type && file.type !== "application/pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
      message("Please choose a PDF file.", true);
      return;
    }

    try {
      message("Loading PDF…");
      pdfBytes = new Uint8Array(await file.arrayBuffer());
      pdfJsDoc = await window.pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
      pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);

      currentPage = 1;
      pageActions = {};
      history = [];

      pageSelect.innerHTML = "";
      for (let i = 1; i <= pdfJsDoc.numPages; i++) {
        const option = document.createElement("option");
        option.value = i;
        option.textContent = `Page ${i}`;
        pageSelect.appendChild(option);
      }

      landingTool.classList.add("hidden");
      editorApp.classList.remove("hidden");
      $("#workspaceTitle").textContent = "PDF Editor";
      $("#workspaceHint").textContent = `${file.name} • ${pdfJsDoc.numPages} page${pdfJsDoc.numPages === 1 ? "" : "s"}`;
      renderPage(1);
    } catch (err) {
      console.error(err);
      message("Could not open this PDF. Try another file.", true);
    }
  }

  async function renderPage(pageNumber) {
    if (!pdfJsDoc) return;
    currentPage = Math.max(1, Math.min(pageNumber, pdfJsDoc.numPages));
    pageSelect.value = currentPage;

    const page = await pdfJsDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1.35 });
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    drawCanvas.width = viewport.width;
    drawCanvas.height = viewport.height;
    pageStage.style.width = viewport.width + "px";
    pageStage.style.height = viewport.height + "px";

    await page.render({ canvasContext: pdfCanvas.getContext("2d"), viewport }).promise;

    clearCanvas();
    history = [];
    if (pageActions[currentPage]) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = pageActions[currentPage];
    }
  }

  function saveCurrentOverlay() {
    pageActions[currentPage] = drawCanvas.toDataURL("image/png");
  }

  async function downloadPdf() {
    if (!pdfDoc) return;

    saveCurrentOverlay();
    const out = await PDFLib.PDFDocument.load(pdfBytes);
    const pages = out.getPages();

    for (let i = 0; i < pages.length; i++) {
      const dataUrl = pageActions[i + 1];
      if (!dataUrl) continue;

      const png = await out.embedPng(dataUrl);
      const page = pages[i];
      const { width, height } = page.getSize();
      page.drawImage(png, { x: 0, y: 0, width, height });
    }

    const result = await out.save();
    const blob = new Blob([result], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pdfix-edited.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  function addText(point) {
    const text = prompt("Enter text:");
    if (!text) return;
    snapshot();
    ctx.fillStyle = colorPicker.value;
    ctx.font = `${Math.max(12, Number(sizePicker.value) * 5)}px Arial`;
    ctx.textBaseline = "top";
    ctx.fillText(text, point.x, point.y);
    saveCurrentOverlay();
  }

  function drawShape(point) {
    const w = point.x - startPoint.x;
    const h = point.y - startPoint.y;
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = Number(sizePicker.value);
    ctx.fillStyle = colorPicker.value;

    if (currentMode === "rect") {
      ctx.strokeRect(startPoint.x, startPoint.y, w, h);
    } else if (currentMode === "circle") {
      const r = Math.sqrt(w * w + h * h);
      ctx.beginPath();
      ctx.arc(startPoint.x, startPoint.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function pointerDown(e) {
    if (!pdfJsDoc || currentMode === "select") return;
    e.preventDefault();
    drawing = true;
    startPoint = getCanvasPoint(e);
    snapshot();

    if (currentMode === "text") {
      drawing = false;
      addText(startPoint);
      return;
    }

    if (currentMode === "image") {
      drawing = false;
      $("#imageInput").click();
      return;
    }

    ctx.strokeStyle = colorPicker.value;
    ctx.fillStyle = colorPicker.value;
    ctx.lineWidth = Number(sizePicker.value);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (currentMode === "draw" || currentMode === "highlight") {
      ctx.beginPath();
      ctx.moveTo(startPoint.x, startPoint.y);
      if (currentMode === "highlight") {
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = Math.max(12, Number(sizePicker.value) * 4);
      }
    }
  }

  function pointerMove(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = getCanvasPoint(e);

    if (currentMode === "draw" || currentMode === "highlight") {
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (currentMode === "rect" || currentMode === "circle") {
      ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      const img = history[history.length - 1];
      if (img) ctx.putImageData(img, 0, 0);
      drawShape(p);
    }
  }

  function pointerUp() {
    if (!drawing) return;
    drawing = false;
    ctx.globalAlpha = 1;
    saveCurrentOverlay();
  }

  async function insertImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        snapshot();
        const max = Math.min(drawCanvas.width, drawCanvas.height) * 0.6;
        const scale = Math.min(max / img.width, max / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (drawCanvas.width - w) / 2, (drawCanvas.height - h) / 2, w, h);
        saveCurrentOverlay();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function parsePageNumbers(input, total) {
    const nums = new Set();
    for (const part of input.split(",")) {
      const value = part.trim();
      if (!value) continue;
      if (value.includes("-")) {
        const [a,b] = value.split("-").map(Number);
        if (Number.isInteger(a) && Number.isInteger(b)) {
          const from = Math.min(a,b), to = Math.max(a,b);
          for (let n=from; n<=to; n++) if (n>=1 && n<=total) nums.add(n);
        }
      } else {
        const n = Number(value);
        if (Number.isInteger(n) && n>=1 && n<=total) nums.add(n);
      }
    }
    return [...nums].sort((a,b)=>a-b);
  }

  function showToolControls(tool) {
    const box = $("#toolControls");
    box.innerHTML = "";
    box.classList.remove("hidden");

    if (tool === "imagepdf") {
      box.innerHTML = `
        <h4>Image → PDF</h4>
        <p>Select one or more JPG, PNG, WEBP or other supported images. Each image becomes a PDF page.</p>
        <button class="primary-btn" id="imagePdfBtn">Choose Images</button>
        <input type="file" id="imagePdfInput" accept="image/*" multiple hidden>
      `;
      $("#imagePdfBtn").onclick = () => $("#imagePdfInput").click();
      $("#imagePdfInput").onchange = e => createPdfFromImages([...e.target.files]);
      return;
    }

    if (tool === "rotate") {
      box.innerHTML = `
        <h4>Rotate PDF pages</h4>
        <div class="control-row"><label>Pages <input class="page-input" id="rotatePages" placeholder="Example: 1,3,5 or 1-4"></label></div>
        <div class="control-row"><label>Rotation
          <select id="rotateDegrees" class="page-input"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select>
        </label><button class="primary-btn" id="rotateBtn">Rotate & Download</button></div>
        <small>Leave Pages empty to rotate every page.</small>
      `;
      $("#rotateBtn").onclick = () => rotatePdf($("#rotatePages").value, Number($("#rotateDegrees").value));
      return;
    }

    if (tool === "delete" || tool === "extract" || tool === "split") {
      const title = tool === "delete" ? "Delete PDF pages" : tool === "extract" ? "Extract PDF pages" : "Split PDF";
      const action = tool === "delete" ? "Delete & Download" : tool === "extract" ? "Extract & Download" : "Split & Download";
      box.innerHTML = `
        <h4>${title}</h4>
        <div class="control-row"><label>Pages <input class="page-input" id="pageNumbers" placeholder="Example: 1,3,5 or 1-4"></label>
        <button class="primary-btn" id="pageActionBtn">${action}</button></div>
        <small>${tool === "delete" ? "Enter the pages you want to remove." : "Enter the pages you want to include."}</small>
      `;
      $("#pageActionBtn").onclick = () => processPageTool(tool, $("#pageNumbers").value);
      return;
    }
    box.classList.add("hidden");
  }

  async function loadPdfBytesFromFile(file) {
    if (!file || ((file.type && file.type !== "application/pdf") && !file.name.toLowerCase().endsWith(".pdf"))) throw new Error("Please choose a PDF file.");
    pdfBytes = new Uint8Array(await file.arrayBuffer());
  }

  async function processPageTool(tool, input) {
    if (!pdfBytes) { message("Choose a PDF first.", true); return; }
    try {
      const doc = await PDFLib.PDFDocument.load(pdfBytes);
      const total = doc.getPageCount();
      const nums = parsePageNumbers(input, total);
      if (!nums.length) { message("Enter valid page numbers.", true); return; }

      if (tool === "delete") {
        if (nums.length >= total) { message("You cannot delete every page from a PDF.", true); return; }
        const keep = Array.from({length: total}, (_,i)=>i).filter(i=>!nums.includes(i+1));
        const out = await PDFLib.PDFDocument.create();
        const copied = await out.copyPages(doc, keep);
        copied.forEach(p=>out.addPage(p));
        await savePdf(out, "pdfix-pages-deleted.pdf");
      } else {
        const out = await PDFLib.PDFDocument.create();
        const copied = await out.copyPages(doc, nums.map(n=>n-1));
        copied.forEach(p=>out.addPage(p));
        await savePdf(out, tool === "split" ? "pdfix-split.pdf" : "pdfix-extracted.pdf");
      }
      message("Done — your PDF download should start now.");
    } catch (err) {
      console.error(err); message("Could not process this PDF.", true);
    }
  }

  async function rotatePdf(input, degrees) {
    if (!pdfBytes) { message("Choose a PDF first.", true); return; }
    try {
      const doc = await PDFLib.PDFDocument.load(pdfBytes);
      const total = doc.getPageCount();
      const nums = input.trim() ? parsePageNumbers(input, total) : Array.from({length:total}, (_,i)=>i+1);
      if (!nums.length) { message("Enter valid page numbers.", true); return; }
      const selected = new Set(nums);
      doc.getPages().forEach((page, i) => {
        if (selected.has(i+1)) {
          const current = page.getRotation().angle || 0;
          page.setRotation(PDFLib.degrees((current + degrees) % 360));
        }
      });
      await savePdf(doc, "pdfix-rotated.pdf");
      message(`Rotated ${nums.length} page${nums.length === 1 ? "" : "s"} by ${degrees}° clockwise.`);
    } catch (err) { console.error(err); message("Could not rotate this PDF.", true); }
  }

  async function createPdfFromImages(files) {
    if (!files.length) return;
    try {
      message("Creating PDF from images…");
      const doc = await PDFLib.PDFDocument.create();
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let image;
        const type = file.type.toLowerCase();
        if (type.includes("png")) image = await doc.embedPng(bytes);
        else if (type.includes("jpeg") || type.includes("jpg")) image = await doc.embedJpg(bytes);
        else {
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
          image = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
          bitmap.close?.();
        }
        const maxW = 595, maxH = 842;
        const scale = Math.min(maxW / image.width, maxH / image.height, 1);
        const w = image.width * scale, h = image.height * scale;
        const page = doc.addPage([w, h]);
        page.drawImage(image, {x:0, y:0, width:w, height:h});
      }
      await savePdf(doc, "pdfix-images.pdf");
      message(`Created a PDF with ${files.length} image${files.length === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error(err); message("Could not convert the selected images to PDF.", true);
    }
  }

  async function mergePdfs(files) {
    if (!files.length) return;
    try {
      message("Merging PDF files…");
      const out = await PDFLib.PDFDocument.create();
      for (const file of files) {
        if ((file.type && file.type !== "application/pdf") && !file.name.toLowerCase().endsWith(".pdf")) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const src = await PDFLib.PDFDocument.load(bytes);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(page => out.addPage(page));
      }
      if (out.getPageCount() === 0) throw new Error("No valid PDF files selected.");
      await savePdf(out, "pdfix-merged.pdf");
      message(`Merged ${files.length} PDF file${files.length === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error(err);
      message("Could not merge the selected PDF files.", true);
    }
  }

  async function exportPdfImages(file) {
    if (!file) return;
    try {
      message("Rendering PDF pages as images…");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await window.pdfjsLib.getDocument({data: bytes}).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({scale: 1.5});
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({canvasContext: canvas.getContext("2d"), viewport}).promise;
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `pdfix-page-${i}.png`;
        a.click();
        await new Promise(r => setTimeout(r, 80));
      }
      message(`Exported ${doc.numPages} page${doc.numPages === 1 ? "" : "s"} as PNG images.`);
    } catch (err) {
      console.error(err);
      message("Could not export the PDF as images.", true);
    }
  }

  async function simplePdfTool(tool) {
    if (!pdfBytes) { message("Choose a PDF first.", true); return; }
    if (tool === "info") {
      const doc = await PDFLib.PDFDocument.load(pdfBytes);
      const pages = doc.getPages();
      alert(`Pages: ${pages.length}\nSize: ${(pdfBytes.length / 1024 / 1024).toFixed(2)} MB\nTitle: ${doc.getTitle() || "—"}\nAuthor: ${doc.getAuthor() || "—"}`);
      return;
    }
    showToolControls(tool);
    if (["rotate","delete","extract","split"].includes(tool)) message("PDF loaded. Set your options above.");
  }
  async function savePdf(doc, filename) {
    const bytes = await doc.save();
    const blob = new Blob([bytes], {type:"application/pdf"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  $$(".tool-card").forEach(card => {
    card.addEventListener("click", async () => {
      $$(".tool-card").forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      const tool = card.dataset.tool;

      if (tool === "editor") {
        $("#workspaceTitle").textContent = "PDF Editor";
        $("#workspaceHint").textContent = "Upload a PDF to start editing.";
        landingTool.classList.remove("hidden");
        editorApp.classList.add("hidden");
        $("#toolControls").classList.add("hidden");
        fileInput.accept = "application/pdf";
        fileInput.multiple = false;
        return;
      }

      $("#workspaceTitle").textContent = card.querySelector("strong").textContent;
      $("#workspaceHint").textContent = card.querySelector("small").textContent;
      landingTool.classList.remove("hidden");
      editorApp.classList.add("hidden");
      $("#toolControls").classList.add("hidden");
      message("Choose a PDF to use this tool.");
      window.currentSimpleTool = tool;
      if (tool === "imagepdf") {
        fileInput.accept = "image/*";
        fileInput.multiple = true;
      } else if (tool === "merge") {
        fileInput.accept = ".pdf,application/pdf";
        fileInput.multiple = true;
      } else {
        fileInput.accept = ".pdf,application/pdf";
        fileInput.multiple = false;
      }
    });
  });

  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files];
    const file = files[0];
    if (!file) return;
    if (window.currentSimpleTool === "imagepdf") {
      await createPdfFromImages(files);
      window.currentSimpleTool = null;
      fileInput.accept = ".pdf,application/pdf";
      fileInput.multiple = false;
      return;
    }
    if (window.currentSimpleTool === "merge") {
      await mergePdfs(files);
      window.currentSimpleTool = null;
      fileInput.accept = ".pdf,application/pdf";
      fileInput.multiple = false;
      return;
    }
    if (window.currentSimpleTool === "image") {
      await exportPdfImages(file);
      window.currentSimpleTool = null;
      return;
    }
    if (window.currentSimpleTool && window.currentSimpleTool !== "editor") {
      try { await loadPdfBytesFromFile(file); await simplePdfTool(window.currentSimpleTool); }
      catch (err) { console.error(err); message(err.message || "Could not load PDF.", true); }
      window.currentSimpleTool = null;
    } else {
      await openPdf(file);
    }
  });

  ["dragenter","dragover"].forEach(ev => dropzone.addEventListener(ev, e => {
    e.preventDefault(); dropzone.style.borderColor = "var(--primary)";
  }));
  ["dragleave","drop"].forEach(ev => dropzone.addEventListener(ev, e => {
    e.preventDefault(); dropzone.style.borderColor = "#93c5fd";
  }));
  dropzone.addEventListener("drop", e => openPdf(e.dataTransfer.files[0]));

  pageSelect.addEventListener("change", e => {
    saveCurrentOverlay();
    renderPage(Number(e.target.value));
  });

  $$(".toolbar-btn[data-toolmode]").forEach(btn => btn.addEventListener("click", () => {
    $$(".toolbar-btn[data-toolmode]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.toolmode;
    if (currentMode === "select") drawCanvas.style.cursor = "default";
    else if (currentMode === "text") drawCanvas.style.cursor = "text";
    else drawCanvas.style.cursor = "crosshair";
  }));

  $$(".toolbar-btn[data-action]").forEach(btn => btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    if (action === "prev") { saveCurrentOverlay(); renderPage(currentPage - 1); }
    if (action === "next") { saveCurrentOverlay(); renderPage(currentPage + 1); }
    if (action === "undo") { restoreHistory(); saveCurrentOverlay(); }
    if (action === "clear") { snapshot(); clearCanvas(); saveCurrentOverlay(); }
  }));

  drawCanvas.addEventListener("pointerdown", pointerDown);
  drawCanvas.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);

  $("#imageInput").addEventListener("change", e => insertImage(e.target.files[0]));
  $("#downloadBtn").addEventListener("click", downloadPdf);

  $("#backBtn").addEventListener("click", () => {
    editorApp.classList.add("hidden");
    landingTool.classList.remove("hidden");
  });

  $("#themeBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    $("#themeBtn").textContent = document.body.classList.contains("dark") ? "☀" : "☾";
  });
})();
