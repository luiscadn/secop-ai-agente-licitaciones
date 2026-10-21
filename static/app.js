// ==========================================================================
// SECOP AI - Client Application Logic
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
  initCompanyProfile();
  initProcessesList();
  initChat();
});

// Format numbers as Colombian Pesos
function formatCOP(num) {
  if (num === null || num === undefined) return "$0";
  const n = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(n)) return "$0";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(n);
}

// Simple Markdown parser for chat messages
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  // Inline Code
  html = html.replace(/`(.*?)`/g, "<code style='background: rgba(255,255,255,0.08); padding: 2px 5px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.85em;'>$1</code>");

  // Tables
  const lines = html.split("\n");
  let inTable = false;
  let tableHtml = "";
  let processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      if (!inTable) {
        inTable = true;
        tableHtml = "<div style='overflow-x: auto; margin: 10px 0;'><table style='width: 100%; border-collapse: collapse; font-size: 0.82rem;'>";
      }
      if (line.includes("---")) {
        // separator row, skip
        continue;
      }
      const cells = line.split("|").slice(1, -1);
      const isHeader = tableHtml.includes("<tbody>") ? false : true;
      if (isHeader && !tableHtml.includes("<thead>")) {
        tableHtml += "<thead><tr style='border-bottom: 2px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.04);'>";
        cells.forEach(c => tableHtml += `<th style='padding: 6px 10px; text-align: left;'>${c.trim()}</th>`);
        tableHtml += "</tr></thead><tbody>";
      } else {
        tableHtml += "<tr style='border-bottom: 1px solid rgba(255,255,255,0.06);'>";
        cells.forEach(c => tableHtml += `<td style='padding: 6px 10px; color: var(--text-secondary);'>${c.trim()}</td>`);
        tableHtml += "</tr>";
      }
    } else {
      if (inTable) {
        inTable = false;
        tableHtml += "</tbody></table></div>";
        processedLines.push(tableHtml);
        tableHtml = "";
      }
      processedLines.push(line);
    }
  }
  if (inTable) {
    tableHtml += "</tbody></table></div>";
    processedLines.push(tableHtml);
  }

  // Lists & Paragraphs
  let finalHtml = "";
  let inList = false;
  for (let l of processedLines) {
    l = l.trim();
    if (l.startsWith("- ") || l.startsWith("* ")) {
      if (!inList) {
        finalHtml += "<ul style='margin: 8px 0 8px 20px; line-height: 1.5;'>";
        inList = true;
      }
      finalHtml += `<li>${l.substring(2)}</li>`;
    } else if (l.match(/^\d+\.\s/)) {
      if (!inList) {
        finalHtml += "<ol style='margin: 8px 0 8px 20px; line-height: 1.5;'>";
        inList = true;
      }
      finalHtml += `<li>${l.replace(/^\d+\.\s/, "")}</li>`;
    } else {
      if (inList) {
        finalHtml += inList === true ? "</ul>" : "</ol>";
        inList = false;
      }
      if (l.length > 0) {
        finalHtml += `<p style='margin-bottom: 8px;'>${l}</p>`;
      }
    }
  }
  if (inList) finalHtml += "</ul>";

  return finalHtml;
}

// --------------------------------------------------------------------------
// 1. CARGAR PERFIL DE LA EMPRESA
// --------------------------------------------------------------------------
async function initCompanyProfile() {
  try {
    const res = await fetch("/api/empresa");
    if (!res.ok) throw new Error("Error al consultar empresa");
    const data = await res.json();
    const perfil = data.perfil;
    const ind = data.indicadores;

    document.getElementById("comp-name").textContent = perfil.razon_social || "Ingeniería y Mantenimiento del Pacífico S.A.S.";
    document.getElementById("comp-nit").textContent = `NIT: ${perfil.nit}`;
    document.getElementById("comp-city").textContent = `${perfil.ciudad}, ${perfil.departamento}`;
    document.getElementById("comp-activity").textContent = perfil.actividad;

    // KPIs
    document.getElementById("val-capital").textContent = formatCOP(ind.capital_de_trabajo);
    document.getElementById("val-liquidez").textContent = ind.indice_liquidez;
    document.getElementById("val-endeudamiento").textContent = `${ind.indice_endeudamiento_pct}%`;
    document.getElementById("val-cobertura").textContent = `${ind.razon_cobertura_intereses}x`;

    // Códigos UNSPSC
    const tagsContainer = document.getElementById("unspsc-tags");
    tagsContainer.innerHTML = "";
    (perfil.rup?.codigos_unspsc || []).forEach(cod => {
      const tag = document.createElement("span");
      tag.className = "code-tag";
      tag.textContent = cod;
      tag.title = "Haz clic para buscar contratos con este código";
      tag.addEventListener("click", () => {
        sendPrompt(`¿Cuánto suma nuestra experiencia en contratos con código UNSPSC ${cod}?`);
      });
      tagsContainer.appendChild(tag);
    });

    // Experiencia
    const expContainer = document.getElementById("exp-list-container");
    expContainer.innerHTML = "";
    (perfil.experiencia || []).forEach(exp => {
      const item = document.createElement("div");
      item.className = "exp-item";
      const id = exp.id || exp.id_contrato || "EXP";
      const year = exp.anio || exp.ano || "";
      const valor = exp.valor || exp.valor_cop || 0;
      const contratante = exp.contratante || "";
      item.innerHTML = `
        <div class="exp-item-header">
          <span class="exp-id">${id} (${year})</span>
          <span class="exp-amount">${formatCOP(valor)}</span>
        </div>
        <div style="font-weight: 500; color: #cbd5e1; font-size: 0.72rem; margin-bottom: 2px;">${contratante}</div>
        <div class="exp-desc">${exp.objeto}</div>
      `;
      expContainer.appendChild(item);
    });

  } catch (err) {
    console.error("Error cargando perfil:", err);
  }
}

// --------------------------------------------------------------------------
// 2. CARGAR Y FILTRAR PROCESOS SECOP
// --------------------------------------------------------------------------
let allProcesses = [];

async function initProcessesList() {
  try {
    const res = await fetch("/api/procesos");
    if (!res.ok) throw new Error("Error al consultar procesos");
    const data = await res.json();
    allProcesses = data.procesos || [];

    document.getElementById("proceso-counter").textContent = `${allProcesses.length} contratos`;
    renderProcesses(allProcesses);

    // Search filter
    const searchInput = document.getElementById("process-search-input");
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        renderProcesses(allProcesses);
        return;
      }
      const filtered = allProcesses.filter(p => {
        const text = `${p.entidad || ""} ${p.referencia_del_proceso || ""} ${p.ciudad_entidad || ""} ${p.modalidad_de_contratacion || ""} ${p.descripci_n_del_procedimiento || ""}`.toLowerCase();
        return text.includes(q);
      });
      renderProcesses(filtered);
    });

  } catch (err) {
    console.error("Error cargando procesos:", err);
  }
}

function renderProcesses(list) {
  const container = document.getElementById("process-list-container");
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = "<div style='color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 20px;'>No se encontraron procesos</div>";
    return;
  }

  list.forEach(p => {
    const card = document.createElement("div");
    card.className = "process-card";
    const ref = p.referencia_del_proceso || p.id_del_proceso;
    const precio = parseFloat(p.precio_base) > 0 ? formatCOP(p.precio_base) : "Presupuesto $0 (Verificar)";
    const modalidad = (p.modalidad_de_contratacion || "Modalidad no reg.").substring(0, 24);

    card.innerHTML = `
      <div class="process-ref">${ref}</div>
      <div class="process-entity">${p.entidad || "Entidad pública"}</div>
      <div class="process-budget">${precio}</div>
      <div class="process-tags">
        <span class="process-tag">${p.ciudad_entidad || p.departamento_entidad || "Colombia"}</span>
        <span class="process-tag">${modalidad}</span>
      </div>
      <button class="analyze-btn" data-ref="${ref}" data-entity="${p.entidad}">
        ⚡ Analizar Viabilidad
      </button>
    `;

    // Button click
    card.querySelector(".analyze-btn").addEventListener("click", () => {
      sendPrompt(`Analiza el proceso ${ref} de ${p.entidad} con presupuesto ${precio}: ¿Nos conviene presentarnos o no según nuestro capital de trabajo y perfil?`);
    });

    container.appendChild(card);
  });
}

// --------------------------------------------------------------------------
// 3. CHAT Y COMUNICACIÓN CON EL AGENTE
// --------------------------------------------------------------------------
function initChat() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("user-input");

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = (input.scrollHeight) + "px";
  });

  // Enter to send
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event("submit"));
    }
  });

  // Suggested prompt pills
  document.querySelectorAll(".prompt-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-prompt");
      sendPrompt(p);
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.style.height = "auto";
    sendPrompt(text);
  });
}

async function sendPrompt(pregunta) {
  const chatContainer = document.getElementById("chat-messages");
  const sendBtn = document.getElementById("send-btn");

  // 1. Append User Message
  const userMsg = document.createElement("div");
  userMsg.className = "message-wrapper message-user";
  userMsg.innerHTML = `
    <div class="avatar avatar-user">👤</div>
    <div class="bubble">${escapeHtml(pregunta)}</div>
  `;
  chatContainer.appendChild(userMsg);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // 2. Append Loading Indicator
  const loadingMsg = document.createElement("div");
  loadingMsg.className = "message-wrapper message-ai";
  loadingMsg.id = "loading-message";
  loadingMsg.innerHTML = `
    <div class="avatar avatar-ai">🤖</div>
    <div class="bubble" style="color: var(--text-muted); font-size: 0.85rem;">
      <div style="margin-bottom: 6px;">Analizando datos de SECOP II y consultando herramientas...</div>
      <div class="typing-dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  `;
  chatContainer.appendChild(loadingMsg);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  sendBtn.disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pregunta })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Error en el servidor");
    }

    const data = await res.json();
    loadingMsg.remove();

    // 3. Render AI Response
    let decisionHtml = "";
    if (data.decision === "VIABLE") {
      decisionHtml = `<div class="decision-banner decision-VIABLE">✅ Oportunidad Viable (Go)</div>`;
    } else if (data.decision === "NO_VIABLE") {
      decisionHtml = `<div class="decision-banner decision-NO_VIABLE">⚠️ No Recomendado / Inconsistencia (No-Go)</div>`;
    } else if (data.decision === "CONSORCIO") {
      decisionHtml = `<div class="decision-banner decision-CONSORCIO">🤝 Requiere Consorcio / Alianza</div>`;
    }

    let toolsHtml = "";
    if (data.herramientas && data.herramientas.length > 0) {
      const chips = data.herramientas.map(t => `<span class="tool-chip">🔧 ${t}</span>`).join(" ");
      toolsHtml = `
        <div class="tools-badge-container">
          <span class="tools-label">Herramientas ejecutadas:</span>
          ${chips}
        </div>
      `;
    }

    const aiMsg = document.createElement("div");
    aiMsg.className = "message-wrapper message-ai";
    aiMsg.innerHTML = `
      <div class="avatar avatar-ai">🤖</div>
      <div class="bubble">
        ${decisionHtml}
        <div>${renderMarkdown(data.respuesta)}</div>
        ${toolsHtml}
        <div class="msg-footer">
          <span>⚡ Latencia: ${data.latencia}s</span>
          <span>💰 Costo aprox: $${data.costo_est_usd.toFixed(4)} USD</span>
          <span>🧠 ${data.modelo}</span>
        </div>
      </div>
    `;

    chatContainer.appendChild(aiMsg);
    chatContainer.scrollTop = chatContainer.scrollHeight;

  } catch (error) {
    loadingMsg.remove();
    const errorMsg = document.createElement("div");
    errorMsg.className = "message-wrapper message-ai";
    errorMsg.innerHTML = `
      <div class="avatar avatar-ai" style="background: var(--accent-rose);">⚠️</div>
      <div class="bubble" style="border-color: rgba(244, 63, 94, 0.4); color: #fda4af;">
        <strong>Error en la consulta:</strong> ${error.message}
      </div>
    `;
    chatContainer.appendChild(errorMsg);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  } finally {
    sendBtn.disabled = false;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
