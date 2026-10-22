/* PDFix Compressor add-on. Kept separate so existing PDF tools remain unchanged. */
(async function () {
  "use strict";

  const ready = window.pdfjsReady;
  const PDFLib = window.PDFLib;
  const $ = (selector) => document.querySelector(selector);

  try {
    if (ready) await ready;
  } catch (error) {
    console.error("PDFix compressor could not load PDF.js:", error);
  }

  function setMessage(text, error = false) {
    const node = $("#compressorMessage");
    if (!node) return;
    node.textContent = text;
    node.style.color = error ? "var(--danger)" : "var(--muted)";
  }

  async function compressPdf(file, mode, button) {
    if (!file) {
      setMessage("Choose a PDF file first.", true);
      return;
    }
    if (!window.PDFLib || !window.pdfjsLib) {
      setMessage("The PDF engines did not load. Check your internet connection and reload the page.", true);
      return;
    }
    button.disabled = true;
    button.textContent = "Compressing…";
    try {
      const inputBytes = new Uint8Array(await file.arrayBuffer());
      let outputBytes;

      if (mode === "maximum") {
        setMessage("Preparing pages for maximum compression. Large files may take a few minutes.");
        const source = await window.pdfjsLib.getDocument({ data: inputBytes.slice() }).promise;
        const output = await PDFLib.PDFDocument.create();
        const total = source.numPages;

        for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
          setMessage(`Maximum compression: processing page ${pageNumber} of ${total}…`);
          const sourcePage = await source.getPage(pageNumber);
          const base = sourcePage.getViewport({ scale: 1 });
          const viewport = sourcePage.getViewport({ scale: 1.05 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext("2d", { alpha: false });
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          await sourcePage.render({
            canvasContext: context,
            viewport,
            background: "#ffffff"
          }).promise;

          const jpegBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(
              blob => blob ? resolve(blob) : reject(new Error("Could not encode a PDF page.")),
              "image/jpeg",
              0.48
            );
          });
          const image = await output.embedJpg(new Uint8Array(await jpegBlob.arrayBuffer()));
          const page = output.addPage([base.width, base.height]);
          page.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
          canvas.width = 1;
          canvas.height = 1;
          sourcePage.cleanup();
        }
        await source.destroy();
        outputBytes = await output.save({ useObjectStreams: true });
      } else {
        setMessage("Optimizing the PDF structure while preserving selectable text…");
        const doc = await PDFLib.PDFDocument.load(inputBytes);
        outputBytes = await doc.save({ useObjectStreams: true });
      }

      const blob = new Blob([outputBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = mode === "maximum"
        ? "pdfix-compressed-maximum.pdf"
        : "pdfix-compressed-balanced.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      const originalSize = inputBytes.length;
      const finalSize = outputBytes.length;
      const change = Math.round((1 - finalSize / originalSize) * 100);
      const sizeLabel = n => n >= 1024 * 1024
        ? `${(n / (1024 * 1024)).toFixed(2)} MB`
        : `${(n / 1024).toFixed(1)} KB`;
      const result = change >= 0 ? `${change}% smaller` : `${Math.abs(change)}% larger`;
      setMessage(`Finished: ${sizeLabel(originalSize)} → ${sizeLabel(finalSize)} (${result}).`);
    } catch (error) {
      console.error("PDFix compression failed:", error);
      setMessage("Compression failed. The PDF may be encrypted, damaged, or too large for this device.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Compress & Download";
    }
  }

  function installCompressorCard() {
    const grid = $(".tools-grid");
    if (!grid) return;

    let card = grid.querySelector('[data-tool="compress"]');
    if (!card) {
      card = document.createElement("button");
      card.className = "tool-card";
      card.dataset.tool = "compress";
      card.innerHTML = '<span class="tool-icon">⇩</span><strong>Compress PDF</strong><small>Reduce PDF file size</small>';
      grid.appendChild(card);
    }

    card.addEventListener("click", () => {
      document.querySelectorAll(".tool-card").forEach(item => item.classList.remove("active"));
      card.classList.add("active");

      const title = $("#workspaceTitle");
      const hint = $("#workspaceHint");
      const landing = $("#landingTool");
      const editor = $("#editorApp");
      const oldControls = $("#toolControls");
      if (title) title.textContent = "Compress PDF";
      if (hint) hint.textContent = "Choose balanced or maximum compression.";
      if (landing) landing.classList.remove("hidden");
      if (editor) editor.classList.add("hidden");
      if (oldControls) oldControls.classList.add("hidden");

      const oldPanel = $("#compressorPanel");
      if (oldPanel) oldPanel.remove();

      const panel = document.createElement("div");
      panel.id = "compressorPanel";
      panel.innerHTML = `
        <h4>Compress PDF</h4>
        <label for="compressorFile">PDF file</label>
        <input id="compressorFile" type="file" accept=".pdf,application/pdf">
        <div class="compress-row">
          <label for="compressorMode">Compression level</label>
          <select id="compressorMode">
            <option value="balanced">Balanced — preserve selectable text</option>
            <option value="maximum">Maximum — smaller, image-based pages</option>
          </select>
          <button class="primary-btn" id="compressorStart">Compress & Download</button>
        </div>
        <p class="compression-note"><strong>Balanced:</strong> rewrites the PDF using object streams where supported. It preserves page content and selectable text, but the size reduction may be modest, especially for PDFs already optimized.</p>
        <p class="compression-note"><strong>Maximum:</strong> renders each page as a compressed JPEG image. This can reduce scanned or photo-heavy PDFs more, but text will no longer be selectable/searchable, and links, forms, accessibility tags, or other interactive features may not be preserved.</p>
        <div id="compressorMessage" role="status" aria-live="polite">Choose a PDF to begin. Files are processed locally in your browser.</div>
      `;
      landing.appendChild(panel);

      $("#compressorStart").addEventListener("click", () => {
        const file = $("#compressorFile").files[0];
        if (file && file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          setMessage("Please choose a PDF file.", true);
          return;
        }
        compressPdf(file, $("#compressorMode").value, $("#compressorStart"));
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installCompressorCard, { once: true });
  } else {
    installCompressorCard();
  }
})();
