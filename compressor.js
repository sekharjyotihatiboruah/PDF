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

  async function buildImagePdf(inputBytes, quality, scale, progressPrefix = "Maximum compression") {
    const source = await window.pdfjsLib.getDocument({ data: inputBytes.slice() }).promise;
    const output = await PDFLib.PDFDocument.create();
    const total = source.numPages;

    try {
      for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
        setMessage(`${progressPrefix}: processing page ${pageNumber} of ${total}…`);
        const sourcePage = await source.getPage(pageNumber);
        const base = sourcePage.getViewport({ scale: 1 });
        const viewport = sourcePage.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is not available on this device.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await sourcePage.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;

        const jpegBlob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error("Could not encode a PDF page.")),
            "image/jpeg",
            quality
          );
        });
        const image = await output.embedJpg(new Uint8Array(await jpegBlob.arrayBuffer()));
        const page = output.addPage([base.width, base.height]);
        page.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
        canvas.width = 1;
        canvas.height = 1;
        sourcePage.cleanup();
      }
      return await output.save({ useObjectStreams: true });
    } finally {
      await source.destroy();
    }
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

    const targetKB = Number($("#targetSizeKB")?.value);
    if (mode === "target" && (!Number.isFinite(targetKB) || targetKB < 10)) {
      setMessage("Enter a target size of at least 10 KB.", true);
      return;
    }

    button.disabled = true;
    button.textContent = "Compressing…";
    try {
      const inputBytes = new Uint8Array(await file.arrayBuffer());
      let outputBytes;
      let outputName = "pdfix-compressed-balanced.pdf";

      if (mode === "maximum") {
        outputBytes = await buildImagePdf(inputBytes, 0.48, 1.05);
        outputName = "pdfix-compressed-maximum.pdf";
      } else if (mode === "target") {
        const targetBytes = Math.floor(targetKB * 1024);
        // Try progressively smaller rasterized versions. The target is a goal, not a guarantee.
        const candidates = [
          { quality: 0.62, scale: 1.1 },
          { quality: 0.48, scale: 1.0 },
          { quality: 0.36, scale: 0.85 },
          { quality: 0.27, scale: 0.72 },
          { quality: 0.19, scale: 0.6 },
          { quality: 0.12, scale: 0.5 }
        ];
        let smallest = null;
        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          setMessage(`Target size ${targetKB} KB: trying compression level ${i + 1} of ${candidates.length}…`);
          const attempt = await buildImagePdf(inputBytes, candidate.quality, candidate.scale, "Target-size compression");
          if (!smallest || attempt.length < smallest.length) smallest = attempt;
          if (attempt.length <= targetBytes) {
            outputBytes = attempt;
            break;
          }
        }
        if (!outputBytes) outputBytes = smallest;
        outputName = `pdfix-target-${targetKB}kb.pdf`;
      } else {
        setMessage("Optimizing the PDF structure while preserving selectable text…");
        const doc = await PDFLib.PDFDocument.load(inputBytes);
        outputBytes = await doc.save({ useObjectStreams: true });
      }

      const url = URL.createObjectURL(new Blob([outputBytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = outputName;
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
      const targetNote = mode === "target"
        ? (finalSize <= targetKB * 1024
            ? ` Target achieved (goal: ${targetKB} KB).`
            : ` Could not reach ${targetKB} KB; this is the smallest version found in the available attempts.`)
        : "";
      setMessage(`Finished: ${sizeLabel(originalSize)} → ${sizeLabel(finalSize)} (${result}).${targetNote}`);
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
          <label for="compressorMode">Compression option</label>
          <select id="compressorMode">
            <option value="balanced">Balanced — preserve selectable text</option>
            <option value="maximum">Maximum — image-based pages</option>
            <option value="target">Target file size — choose KB</option>
          </select>
          <label for="targetSizeKB">Target (KB)</label>
          <input id="targetSizeKB" type="number" min="10" step="10" value="150" inputmode="numeric" aria-label="Target PDF size in kilobytes">
          <button class="primary-btn" id="compressorStart">Compress & Download</button>
        </div>
        <p class="compression-note"><strong>Balanced:</strong> rewrites the PDF using object streams where supported. It preserves page content and selectable text, but the size reduction may be modest, especially for PDFs already optimized.</p>
        <p class="compression-note"><strong>Maximum:</strong> renders each page as a compressed JPEG image. This can reduce scanned or photo-heavy PDFs more, but text will no longer be selectable/searchable, and links, forms, accessibility tags, or other interactive features may not be preserved.</p>
        <p class="compression-note"><strong>Target file size:</strong> enter a goal such as 150 KB for a 300 KB PDF. It tries progressively stronger image compression and reports if the target cannot be reached. Target-size mode also converts pages to images.</p>
        <div id="compressorMessage" role="status" aria-live="polite">Choose a PDF to begin. Files are processed locally in your browser.</div>
      `;
      landing.appendChild(panel);

      const modeSelect = $("#compressorMode");
      const targetInput = $("#targetSizeKB");
      const updateTargetVisibility = () => {
        const targetLabel = targetInput?.previousElementSibling;
        const show = modeSelect.value === "target";
        if (targetInput) targetInput.style.display = show ? "inline-block" : "none";
        if (targetLabel) targetLabel.style.display = show ? "inline-flex" : "none";
      };
      modeSelect.addEventListener("change", updateTargetVisibility);
      updateTargetVisibility();

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
