// ==========================================================================
// SECOP AI · Client Application Engine
// Crafted with Emil Kowalski Micro-interactions & Tactile UI Principles
// ==========================================================================

document.addEventListener("DOMContentLoaded", () => {
  initCompanyProfile();
  initProcessesList();
  initChat();
});

// SVG Icons Library for clean rendering without emojis
const ICONS = {
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4 4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z"/><path d="M16 14a8 8 0 0 1 8 8H0a8 8 0 0 1 8-8"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  tool: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  arrowRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  contract: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
};

// Format currency as Colombian Pesos (COP)
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

// Markdown parser for executive memos
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  // Inline code tags
  html = html.replace(/`(.*?)`/g, "<code style='background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.85em; color: #cbd5e1;'>$1</code>");

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
        tableHtml = "<div style='overflow-x: auto; margin: 12px 0;'><table style='width: 100%; border-collapse: collapse; font-size: 0.82rem;'>";
      }
      if (line.includes("---")) {
        continue;
      }
      const cells = line.split("|").slice(1, -1);
      const isHeader = !tableHtml.includes("<tbody>");
      if (isHeader && !tableHtml.includes("<thead>")) {
        tableHtml += "<thead><tr style='border-bottom: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.03);'>";
        cells.forEach(c => tableHtml += `<th style='padding: 8px 12px; text-align: left; font-weight: 600; color: #f8fafc;'>${c.trim()}</th>`);
        tableHtml += "</tr></thead><tbody>";
      } else {
        tableHtml += "<tr style='border-bottom: 1px solid rgba(255,255,255,0.05);'>";
        cells.forEach(c => tableHtml += `<td style='padding: 8px 12px; color: var(--text-secondary);'>${c.trim()}</td>`);
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
        finalHtml += "<ul style='margin: 8px 0 10px 20px; line-height: 1.6;'>";
        inList = true;
      }
      finalHtml += `<li style='margin-bottom: 4px;'>${l.substring(2)}</li>`;
    } else if (l.match(/^\d+\.\s/)) {
      if (!inList) {
        finalHtml += "<ol style='margin: 8px 0 10px 20px; line-height: 1.6;'>";
        inList = true;
      }
      finalHtml += `<li style='margin-bottom: 4px;'>${l.replace(/^\d+\.\s/, "")}</li>`;
    } else {
      if (inList) {
        finalHtml += inList === true ? "</ul>" : "</ol>";
        inList = false;
      }
      if (l.length > 0) {
        finalHtml += `<p style='margin-bottom: 8px; line-height: 1.55;'>${l}</p>`;
      }
    }
  }
  if (inList) finalHtml += "</ul>";

  return finalHtml;
}

// --------------------------------------------------------------------------
// 1. CARGA DE PERFIL EMPRESARIAL Y RUP
// --------------------------------------------------------------------------
async function initCompanyProfile() {
  try {
    const res = await fetch("/api/empresa");
    if (!res.ok) throw new Error("Error al consultar datos corporativos");
    const data = await res.json();
    const perfil = data.perfil;
    const ind = data.indicadores;

    document.getElementById("comp-name").textContent = perfil.razon_social || "Ingeniería y Mantenimiento del Pacífico S.A.S.";
    
    const nitContainer = document.getElementById("comp-nit");
    nitContainer.querySelector("span").textContent = `NIT: ${perfil.nit}`;
    
    const cityContainer = document.getElementById("comp-city");
    cityContainer.querySelector("span").textContent = `${perfil.ciudad}, ${perfil.departamento}`;

    // Indicadores financieros con formato numérico tabular
    document.getElementById("val-capital").textContent = formatCOP(ind.capital_de_trabajo);
    document.getElementById("val-liquidez").textContent = ind.indice_liquidez;
    document.getElementById("val-endeudamiento").textContent = `${ind.indice_endeudamiento_pct}%`;
    document.getElementById("val-cobertura").textContent = `${ind.razon_cobertura_intereses}x`;

    // Códigos UNSPSC registrados en RUP
    const tagsContainer = document.getElementById("unspsc-tags");
    tagsContainer.innerHTML = "";
    (perfil.rup?.codigos_unspsc || []).forEach(cod => {
      const tag = document.createElement("button");
      tag.className = "code-tag";
      tag.textContent = cod;
      tag.title = `Consultar experiencia con código ${cod}`;
      tag.setAttribute("aria-label", `Buscar contratos UNSPSC ${cod}`);
      tag.addEventListener("click", () => {
        sendPrompt(`¿Cuánto suma nuestra experiencia en contratos con código UNSPSC ${cod}?`);
      });
      tagsContainer.appendChild(tag);
    });

    // Contratos de experiencia certificada
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
        <div class="exp-item-top">
          <span class="exp-id">${id} · ${year}</span>
          <span class="exp-amount tabular-nums">${formatCOP(valor)}</span>
        </div>
        <div class="exp-client">${contratante}</div>
        <div class="exp-desc">${exp.objeto}</div>
      `;
      expContainer.appendChild(item);
    });

  } catch (err) {
    console.error("Error al cargar perfil de empresa:", err);
  }
}

// --------------------------------------------------------------------------
// 2. EXPLORADOR DE PROCESOS SECOP II
// --------------------------------------------------------------------------
let allProcesses = [];

async function initProcessesList() {
  try {
    const res = await fetch("/api/procesos");
    if (!res.ok) throw new Error("Error al obtener procesos");
    const data = await res.json();
    allProcesses = data.procesos || [];

    document.getElementById("proceso-counter").textContent = `${allProcesses.length} contratos`;
    renderProcesses(allProcesses);

    // Búsqueda instantánea con debouncing táctil
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
    console.error("Error al cargar procesos de licitación:", err);
  }
}

function renderProcesses(list) {
  const container = document.getElementById("process-list-container");
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-tertiary); font-size: 0.8rem; text-align: center; padding: 28px 12px;">
        No se encontraron procesos coincidentes
      </div>
    `;
    return;
  }

  list.forEach((p, index) => {
    const card = document.createElement("div");
    card.className = "process-card";
    // Asignación de delay escalonado Emil Kowalski
    card.style.setProperty("--stagger", index);

    const ref = p.referencia_del_proceso || p.id_del_proceso;
    const precio = parseFloat(p.precio_base) > 0 ? formatCOP(p.precio_base) : "Presupuesto a convenir en pliegos";
    const modalidad = (p.modalidad_de_contratacion || "Modalidad estándar").substring(0, 26);
    const ciudad = p.ciudad_entidad || p.departamento_entidad || "Nacional";

    card.innerHTML = `
      <div class="process-ref">${ref}</div>
      <div class="process-entity">${p.entidad || "Entidad Estatal"}</div>
      <div class="process-budget tabular-nums">${precio}</div>
      <div class="process-tags">
        <span class="process-tag">${ciudad}</span>
        <span class="process-tag">${modalidad}</span>
      </div>
      <button class="analyze-btn" data-ref="${ref}">
        ${ICONS.arrowRight}
        <span>Analizar Viabilidad</span>
      </button>
    `;

    // Click handler táctil
    const analyzeBtn = card.querySelector(".analyze-btn");
    analyzeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      sendPrompt(`Analiza el proceso ${ref} de ${p.entidad} con presupuesto ${precio}: ¿Nos conviene presentarnos o no según nuestro capital de trabajo y perfil?`);
    });

    container.appendChild(card);
  });
}

// --------------------------------------------------------------------------
// 3. TERMINAL DE ANÁLISIS Y CHAT
// --------------------------------------------------------------------------
function initChat() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("user-input");

  // Auto-ajuste de altura de textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });

  // Enter envía, Shift+Enter inserta salto de línea
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event("submit"));
    }
  });

  // Sugerencias de prompt
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

  // 1. Mensaje del Usuario
  const userMsg = document.createElement("div");
  userMsg.className = "message-wrapper message-user";
  userMsg.innerHTML = `
    <div class="avatar avatar-user" aria-hidden="true">${ICONS.user}</div>
    <div class="bubble">${escapeHtml(pregunta)}</div>
  `;
  chatContainer.appendChild(userMsg);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // 2. Indicador de Análisis
  const loadingMsg = document.createElement("div");
  loadingMsg.className = "message-wrapper message-ai";
  loadingMsg.id = "loading-message";
  loadingMsg.innerHTML = `
    <div class="avatar avatar-ai" aria-hidden="true">${ICONS.ai}</div>
    <div class="bubble">
      <div style="color: var(--text-secondary); font-size: 0.82rem; margin-bottom: 4px;">
        Consultando herramientas de SECOP II y verificando perfil financiero...
      </div>
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
      throw new Error(err.detail || "Error en el servidor de inferencia");
    }

    const data = await res.json();
    loadingMsg.remove();

    // 3. Banner de Decisión Ejecutiva
    let decisionHtml = "";
    if (data.decision === "VIABLE") {
      decisionHtml = `
        <div class="decision-banner decision-VIABLE">
          ${ICONS.check}
          <span>Recomendación Viable · Go</span>
        </div>
      `;
    } else if (data.decision === "NO_VIABLE") {
      decisionHtml = `
        <div class="decision-banner decision-NO_VIABLE">
          ${ICONS.alert}
          <span>No Recomendado · No-Go</span>
        </div>
      `;
    } else if (data.decision === "CONSORCIO") {
      decisionHtml = `
        <div class="decision-banner decision-CONSORCIO">
          ${ICONS.alert}
          <span>Estructura Requerida · Consorcio o AP</span>
        </div>
      `;
    }

    // Herramientas invocadas
    let toolsHtml = "";
    if (data.herramientas && data.herramientas.length > 0) {
      const chips = data.herramientas.map(t => `
        <span class="tool-chip">
          ${ICONS.tool}
          <span>${t}</span>
        </span>
      `).join(" ");
      toolsHtml = `
        <div class="tools-badge-container">
          <span class="tools-label">Herramientas:</span>
          ${chips}
        </div>
      `;
    }

    const aiMsg = document.createElement("div");
    aiMsg.className = "message-wrapper message-ai";
    aiMsg.innerHTML = `
      <div class="avatar avatar-ai" aria-hidden="true">${ICONS.ai}</div>
      <div class="bubble">
        ${decisionHtml}
        <div>${renderMarkdown(data.respuesta)}</div>
        ${toolsHtml}
        <div class="msg-footer">
          <span>Latencia: ${data.latencia}s</span>
          <span>Costo est: $${data.costo_est_usd.toFixed(4)} USD</span>
          <span>Modelo: ${data.modelo}</span>
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
      <div class="avatar avatar-ai" style="background: rgba(244, 63, 94, 0.2); border-color: rgba(244, 63, 94, 0.4); color: #fb7185;" aria-hidden="true">
        ${ICONS.alert}
      </div>
      <div class="bubble" style="border-color: rgba(244, 63, 94, 0.3);">
        <div style="font-weight: 600; color: #fb7185; margin-bottom: 4px;">Aviso del Sistema</div>
        <div style="color: var(--text-secondary); font-size: 0.84rem;">${error.message}</div>
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
