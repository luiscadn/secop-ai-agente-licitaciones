// ==========================================================================
// SECOP AI · DECISION-DRIVEN WORKSPACE APPLICATION ENGINE
// Master-Detail Triage, Pre-scoring, Contextual Copilot & Slide-over Drawer
// ==========================================================================

// Global State
let allProcesses = [];
let activeProcess = null;
let currentFilter = "all";
let savedProcesses = new Set(JSON.parse(localStorage.getItem("secop_tracked_processes") || "[]"));
let companyProfile = null;
let companyIndicators = null;

// Company Financial Constants
const WORKING_CAPITAL = 182000000; // $182.0M COP
const COMPANY_UNSPSC = ["72141000", "81101500", "72101500", "72152700", "72102900"];

document.addEventListener("DOMContentLoaded", () => {
  initDrawer();
  initFilters();
  initSearch();
  initTracking();
  initCopilotChat();
  loadData();
});

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

// Simple Markdown parser for Copilot chat responses
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  // Inline Code
  html = html.replace(/`(.*?)`/g, "<code style='background: #ede9e0; color: #141715; padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.85em;'>$1</code>");

  // Bullet Lists
  const lines = html.split("\n");
  let inList = false;
  let finalHtml = "";
  for (let l of lines) {
    l = l.trim();
    if (l.startsWith("- ") || l.startsWith("* ")) {
      if (!inList) {
        finalHtml += "<ul style='margin: 6px 0 8px 18px; line-height: 1.5;'>";
        inList = true;
      }
      finalHtml += `<li style='margin-bottom: 3px;'>${l.substring(2)}</li>`;
    } else {
      if (inList) {
        finalHtml += "</ul>";
        inList = false;
      }
      if (l.length > 0) {
        finalHtml += `<p style='margin-bottom: 6px; line-height: 1.45;'>${l}</p>`;
      }
    }
  }
  if (inList) finalHtml += "</ul>";

  return finalHtml;
}

// --------------------------------------------------------------------------
// 1. DATA LOADING & PRE-SCORING ENGINE
// --------------------------------------------------------------------------
async function loadData() {
  try {
    // 1. Fetch Company Profile
    const empRes = await fetch("/api/empresa");
    if (empRes.ok) {
      const empData = await empRes.json();
      companyProfile = empData.perfil;
      companyIndicators = empData.indicadores;
      renderCompanyDrawer(companyProfile, companyIndicators);
    }

    // 2. Fetch Processes
    const procRes = await fetch("/api/procesos");
    if (!procRes.ok) throw new Error("Error al consultar licitaciones");
    const procData = await procRes.json();
    const rawList = procData.procesos || [];

    // 3. Compute Pre-scoring for each process
    allProcesses = rawList.map(p => evaluateProcessTriage(p));

    // Update Header filter counts
    updateTriageCounts();

    // Render Master Cards
    renderTriageList();

    // Automate the first step: select the first viable (or first available) process!
    const firstViable = allProcesses.find(p => p.triageStatus === "go") || allProcesses[0];
    if (firstViable) {
      selectProcess(firstViable);
    }

  } catch (err) {
    console.error("Error al inicializar datos:", err);
  }
}

// Pre-scoring Triage Evaluation Algorithm
function evaluateProcessTriage(p) {
  const precio = parseFloat(p.precio_base) || 0;
  const duracion = parseInt(p.duracion) || 0;
  const ref = p.referencia_del_proceso || p.id_del_proceso;
  const categoria = (p.codigo_principal_de_categoria || "").replace(/^V\d+\./, "");
  const unspscMatch = COMPANY_UNSPSC.some(c => categoria.startsWith(c.substring(0, 4)));

  let status = "review"; // "go" | "review" | "nogo"
  let score = 75;
  let verdictTitle = "REVISAR · REQUIERE CONSORCIO O ALIANZA";
  let reason = "";
  let financialCheck = { status: "warn", label: "Capacidad Financiera", desc: "" };
  let unspscCheck = { status: "warn", label: "Clasificación UNSPSC", desc: "" };
  let expCheck = { status: "ok", label: "Experiencia Contractual", desc: "Acredita contratos afines en obras civiles y vías por $1,230M COP." };

  // Rule 1: Plazo 0 días o Presupuesto $0 (Anomalía en SECOP II)
  if (duracion === 0 || precio <= 0) {
    status = "nogo";
    score = 35;
    verdictTitle = "DESCARTAR · INCONSISTENCIA EN DATOS DE PLIEGO";
    reason = duracion === 0 
      ? "Plazo de ejecución registrado en 0 días. Causal de riesgo e inconsistencia en pliegos."
      : "Presupuesto registrado en $0. No es posible verificar capacidad financiera habilitante.";
    financialCheck = { status: "fail", label: "Capacidad Financiera", desc: "Presupuesto $0 o inconsistente en plataforma." };
    unspscCheck = { status: "warn", label: "Clasificación UNSPSC", desc: "Verificar pliegos definitivos." };
  }
  // Rule 2: Presupuesto accesible cubierto ampliamente por capital ($182M)
  else if (precio <= 200000000) {
    const coverage = ((WORKING_CAPITAL / precio) * 100).toFixed(0);
    status = "go";
    score = Math.min(96, 88 + (coverage > 100 ? 8 : 0));
    verdictTitle = `VIABLE · GO (${score}% MATCH HABILITANTE)`;
    reason = `Capital de trabajo disponible ($182.0M) cubre el ${coverage}% del presupuesto oficial.`;
    financialCheck = { status: "ok", label: "Capacidad Financiera", desc: `Capital disponible cubre holgadamente el ${coverage}% del valor oficial.` };
    unspscCheck = { status: unspscMatch ? "ok" : "warn", label: "Clasificación UNSPSC", desc: unspscMatch ? "Código UNSPSC registrado en RUP de la empresa." : "Afinidad técnica con servicios de ingeniería." };
  }
  // Rule 3: Presupuesto intermedio (e.g. FLO-INFRA-SA-MC-007-2025 entre 200M y 380M)
  else if (precio <= 380000000) {
    const coverage = ((WORKING_CAPITAL / precio) * 100).toFixed(1);
    status = "review";
    score = 78;
    verdictTitle = "VIABLE CON CONSORCIO O UNIÓN TEMPORAL";
    reason = `Capital cubre el ${coverage}% del presupuesto. Se recomienda consorcio para alcanzar el 100% exigido.`;
    financialCheck = { status: "warn", label: "Capacidad Financiera", desc: `Capital ($182M) cubre el ${coverage}% del contrato. Requiere socio consorcial.` };
    unspscCheck = { status: unspscMatch ? "ok" : "warn", label: "Clasificación UNSPSC", desc: unspscMatch ? "Código UNSPSC registrado en RUP." : "Código de categoría afín a obras civiles." };
  }
  // Rule 4: Presupuestos muy grandes (> 400M hasta 2.9B COP)
  else {
    const coverage = ((WORKING_CAPITAL / precio) * 100).toFixed(1);
    status = "nogo";
    score = 48;
    verdictTitle = "NO RECOMENDADO INDIVIDUAL (EXCEDE CAPACIDAD)";
    reason = `Presupuesto elevado ($${(precio / 1e6).toFixed(0)}M COP). Tu capital de trabajo ($182M) cubre solo el ${coverage}%.`;
    financialCheck = { status: "fail", label: "Capacidad Financiera", desc: `Capital insuficiente para proponente individual (cubre solo el ${coverage}%).` };
    unspscCheck = { status: "warn", label: "Clasificación UNSPSC", desc: "Requiere validación de consorcio estructurado." };
  }

  return {
    ...p,
    precioNumeric: precio,
    duracionNumeric: duracion,
    triageStatus: status,
    score,
    verdictTitle,
    reason,
    checks: {
      financial: financialCheck,
      unspsc: unspscCheck,
      experience: expCheck
    }
  };
}

// --------------------------------------------------------------------------
// 2. MASTER CARDS STREAM RENDERING
// --------------------------------------------------------------------------
function renderTriageList() {
  const container = document.getElementById("triage-cards-container");
  const searchVal = document.getElementById("triage-search-input").value.toLowerCase().trim();
  container.innerHTML = "";

  // Apply Filter & Search
  const filtered = allProcesses.filter(p => {
    // 1. Triage status filter
    if (currentFilter !== "all" && p.triageStatus !== currentFilter) {
      return false;
    }
    // 2. Search query filter
    if (searchVal) {
      const text = `${p.entidad || ""} ${p.referencia_del_proceso || ""} ${p.ciudad_entidad || ""} ${p.modalidad_de_contratacion || ""} ${p.descripci_n_del_procedimiento || ""}`.toLowerCase();
      if (!text.includes(searchVal)) return false;
    }
    return true;
  });

  document.getElementById("triage-count-summary").textContent = `Mostrando ${filtered.length} de ${allProcesses.length} procesos`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="color: #727a74; font-size: 0.82rem; text-align: center; padding: 40px 12px;">
        No se encontraron procesos para este filtro o criterio de búsqueda
      </div>
    `;
    return;
  }

  filtered.forEach((p, index) => {
    const card = document.createElement("div");
    card.className = "triage-card";
    if (activeProcess && (activeProcess.referencia_del_proceso === p.referencia_del_proceso)) {
      card.classList.add("selected");
    }
    card.style.setProperty("--stagger", index);

    const ref = p.referencia_del_proceso || p.id_del_proceso;
    const precio = p.precioNumeric > 0 ? formatCOP(p.precioNumeric) : "Presupuesto $0 (Verificar pliegos)";
    const modalidad = (p.modalidad_de_contratacion || "Modalidad general").substring(0, 24);
    const ciudad = p.ciudad_entidad || p.departamento_entidad || "Nacional";
    const isSaved = savedProcesses.has(ref);

    // Triage Badge
    let badgeClass = "verdict-review";
    let badgeLabel = `● Revisar (${p.score}%)`;
    if (p.triageStatus === "go") {
      badgeClass = "verdict-go";
      badgeLabel = `● Viable (${p.score}%)`;
    } else if (p.triageStatus === "nogo") {
      badgeClass = "verdict-nogo";
      badgeLabel = `● Descartar (${p.score}%)`;
    }

    card.innerHTML = `
      <div class="card-top-row">
        <span class="triage-verdict-badge ${badgeClass}">${badgeLabel}</span>
        <span class="process-code">${ref}</span>
        <div class="card-meta-right">
          <span class="modality-tag">${modalidad}</span>
          <button class="star-save-btn ${isSaved ? 'saved' : ''}" data-ref="${ref}" title="${isSaved ? 'Quitar de seguimiento' : 'Guardar en seguimiento'}" aria-label="Guardar proceso">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="card-entity-title">${p.entidad || "Entidad Estatal"}</div>

      <div class="card-budget-row">
        <span class="card-budget-value">${precio}</span>
        <span style="font-size: 0.7rem; color: #8a948d;">${ciudad} · ${p.duracionNumeric > 0 ? p.duracionNumeric + ' días' : 'Plazo por verificar'}</span>
      </div>

      <div class="card-reason-line">
        <strong>Triage:</strong> ${p.reason}
      </div>
    `;

    // Click handler to select process and load detail panel
    card.addEventListener("click", () => {
      selectProcess(p);
    });

    // Star button click handler (prevents card selection click)
    const starBtn = card.querySelector(".star-save-btn");
    starBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTrackProcess(ref);
    });

    container.appendChild(card);
  });
}

// Update Header Filter Counts
function updateTriageCounts() {
  const countGo = allProcesses.filter(p => p.triageStatus === "go").length;
  const countReview = allProcesses.filter(p => p.triageStatus === "review").length;
  const countNoGo = allProcesses.filter(p => p.triageStatus === "nogo").length;

  document.getElementById("count-all").textContent = `(${allProcesses.length})`;
  document.getElementById("count-go").textContent = `(${countGo})`;
  document.getElementById("count-review").textContent = `(${countReview})`;
  document.getElementById("count-nogo").textContent = `(${countNoGo})`;
}

// --------------------------------------------------------------------------
// 3. DETAIL PANEL & STRUCTURED CHECKLIST
// --------------------------------------------------------------------------
function selectProcess(p) {
  activeProcess = p;

  // Highlight active card in master list
  document.querySelectorAll(".triage-card").forEach(el => el.classList.remove("selected"));
  const ref = p.referencia_del_proceso || p.id_del_proceso;
  const cards = document.querySelectorAll(".triage-card");
  cards.forEach(card => {
    if (card.querySelector(".process-code")?.textContent === ref) {
      card.classList.add("selected");
    }
  });

  // 1. Header Information
  document.getElementById("detail-proc-id").textContent = ref;
  document.getElementById("detail-entity-name").textContent = `${p.entidad || "Entidad Pública"} · ${p.ciudad_entidad || "Nacional"}`;

  // 2. Verdict Hero Badge & Summary
  const verdictTag = document.getElementById("verdict-title-tag");
  verdictTag.className = `verdict-title-tag verdict-${p.triageStatus}`;
  document.getElementById("verdict-title-text").textContent = p.verdictTitle;
  document.getElementById("verdict-score-pct").textContent = `${p.score}% Match`;
  document.getElementById("verdict-summary-p").textContent = p.reason;

  // 3. Checklist Visual
  const checks = p.checks;
  renderCheckItem("financial", checks.financial);
  renderCheckItem("unspsc", checks.unspsc);
  renderCheckItem("experience", checks.experience);

  // 4. Action Buttons (Micro-conversiones)
  const isSaved = savedProcesses.has(ref);
  const trackBtn = document.getElementById("btn-toggle-track");
  trackBtn.className = `btn-micro btn-track ${isSaved ? 'saved' : ''}`;
  document.getElementById("btn-track-label").textContent = isSaved ? "En Seguimiento" : "Seguimiento";

  // SECOP II Link
  const secopUrl = (p.urlproceso && p.urlproceso.url) 
    ? p.urlproceso.url 
    : `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${p.id_del_proceso || ""}`;
  document.getElementById("btn-open-secop").href = secopUrl;

  // 5. Generate Contextual Pills for this Tender
  renderContextualPills(p);

  // 6. Reset or load contextual chat
  const chatStream = document.getElementById("contextual-chat-stream");
  chatStream.innerHTML = `
    <div class="ctx-msg-ai">
      <strong>Copiloto de Pliegos SECOP II:</strong>
      <p style="margin-top: 4px;">He analizado el proceso <strong>${ref}</strong> con presupuesto de <strong>${p.precioNumeric > 0 ? formatCOP(p.precioNumeric) : "$0"}</strong>. ¿Tienes dudas sobre cláusulas de garantías, plazos de subsanación o causales de rechazo en este pliego?</p>
    </div>
  `;
}

function renderCheckItem(type, item) {
  const iconEl = document.getElementById(`icon-${type}`);
  const descEl = document.getElementById(`desc-${type}`);
  if (!iconEl || !descEl) return;

  iconEl.className = `check-icon-badge check-${item.status}`;
  iconEl.textContent = item.status === "ok" ? "✔" : item.status === "warn" ? "!" : "✕";
  descEl.textContent = item.desc;
}

// --------------------------------------------------------------------------
// 4. CONTEXTUAL COPILOT & QUICK PILLS
// --------------------------------------------------------------------------
function renderContextualPills(p) {
  const container = document.getElementById("contextual-pills-bar");
  container.innerHTML = "";

  const ref = p.referencia_del_proceso || p.id_del_proceso;
  const pills = [
    { label: "Plazos y fechas clave", query: `¿Cuál es el plazo de ejecución y fechas clave del proceso ${ref}?` },
    { label: "Garantías y pólizas", query: `¿Qué garantías o pólizas de cumplimiento exige la entidad en el proceso ${ref}?` },
    { label: "Causales de rechazo", query: `¿Qué causales de rechazo o riesgos técnicos debo cuidar en el proceso ${ref}?` }
  ];

  pills.forEach(item => {
    const btn = document.createElement("button");
    btn.className = "ctx-pill";
    btn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>${item.label}</span>
    `;
    btn.addEventListener("click", () => {
      sendCopilotQuery(item.query);
    });
    container.appendChild(btn);
  });
}

function initCopilotChat() {
  const form = document.getElementById("copilot-form");
  const input = document.getElementById("copilot-input");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    input.value = "";
    sendCopilotQuery(query);
  });
}

async function sendCopilotQuery(query) {
  const chatStream = document.getElementById("contextual-chat-stream");
  const sendBtn = document.getElementById("copilot-send-btn");

  // User message
  const userMsg = document.createElement("div");
  userMsg.className = "ctx-msg-user";
  userMsg.textContent = query;
  chatStream.appendChild(userMsg);
  chatStream.scrollTop = chatStream.scrollHeight;

  // Loading indicator
  const loading = document.createElement("div");
  loading.className = "ctx-msg-ai";
  loading.innerHTML = `<span style="color: var(--c-olive);">Analizando pliego y estados financieros...</span>`;
  chatStream.appendChild(loading);
  chatStream.scrollTop = chatStream.scrollHeight;

  sendBtn.disabled = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pregunta: query })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Error en el servidor");
    }

    const data = await res.json();
    loading.remove();

    const aiMsg = document.createElement("div");
    aiMsg.className = "ctx-msg-ai";
    aiMsg.innerHTML = renderMarkdown(data.respuesta);
    chatStream.appendChild(aiMsg);
    chatStream.scrollTop = chatStream.scrollHeight;

  } catch (err) {
    loading.remove();
    const errMsg = document.createElement("div");
    errMsg.className = "ctx-msg-ai";
    errMsg.style.borderColor = "var(--c-nogo-border)";
    errMsg.innerHTML = `<span style="color: var(--c-nogo);">Error: ${err.message}</span>`;
    chatStream.appendChild(errMsg);
    chatStream.scrollTop = chatStream.scrollHeight;
  } finally {
    sendBtn.disabled = false;
  }
}

// --------------------------------------------------------------------------
// 5. MICRO-CONVERSIONS & ACTIONS
// --------------------------------------------------------------------------
function initTracking() {
  updateTrackingHeader();

  // Toggle Tracking on Detail Panel Button
  document.getElementById("btn-toggle-track").addEventListener("click", () => {
    if (!activeProcess) return;
    const ref = activeProcess.referencia_del_proceso || activeProcess.id_del_proceso;
    toggleTrackProcess(ref);
  });

  // Download PDF / Print
  document.getElementById("btn-download-matrix").addEventListener("click", () => {
    if (!activeProcess) return;
    window.print();
  });

  // Tracking Counter Button filter toggle
  document.getElementById("tracking-counter-btn").addEventListener("click", () => {
    if (savedProcesses.size === 0) {
      alert("Aún no tienes procesos guardados en seguimiento. Haz clic en la estrella de cualquier licitación para añadirla.");
      return;
    }
    const searchInput = document.getElementById("triage-search-input");
    searchInput.value = "";
    // Filter master list to only saved processes
    const filtered = allProcesses.filter(p => savedProcesses.has(p.referencia_del_proceso || p.id_del_proceso));
    renderCustomTriageList(filtered, `Licitaciones en Seguimiento (${filtered.length})`);
  });
}

function toggleTrackProcess(ref) {
  if (savedProcesses.has(ref)) {
    savedProcesses.delete(ref);
  } else {
    savedProcesses.add(ref);
  }
  localStorage.setItem("secop_tracked_processes", JSON.stringify(Array.from(savedProcesses)));
  updateTrackingHeader();

  // Re-render to update star icons
  renderTriageList();

  // Update Detail Panel Button
  if (activeProcess && (activeProcess.referencia_del_proceso === ref || activeProcess.id_del_proceso === ref)) {
    const isSaved = savedProcesses.has(ref);
    const trackBtn = document.getElementById("btn-toggle-track");
    trackBtn.className = `btn-micro btn-track ${isSaved ? 'saved' : ''}`;
    document.getElementById("btn-track-label").textContent = isSaved ? "En Seguimiento" : "Seguimiento";
  }
}

function updateTrackingHeader() {
  const count = savedProcesses.size;
  const badge = document.getElementById("tracking-badge");
  const pill = document.getElementById("tracking-counter-btn");
  badge.textContent = `(${count})`;
  if (count > 0) {
    pill.classList.add("has-saved");
  } else {
    pill.classList.remove("has-saved");
  }
}

function renderCustomTriageList(list, title) {
  const container = document.getElementById("triage-cards-container");
  container.innerHTML = "";
  document.getElementById("triage-count-summary").textContent = title;

  list.forEach((p, index) => {
    // Reuse render logic
    const card = document.createElement("div");
    card.className = "triage-card";
    const ref = p.referencia_del_proceso || p.id_del_proceso;
    if (activeProcess && (activeProcess.referencia_del_proceso === ref)) {
      card.classList.add("selected");
    }
    const precio = p.precioNumeric > 0 ? formatCOP(p.precioNumeric) : "Presupuesto $0";

    card.innerHTML = `
      <div class="card-top-row">
        <span class="triage-verdict-badge verdict-${p.triageStatus}">● ${p.triageStatus.toUpperCase()} (${p.score}%)</span>
        <span class="process-code">${ref}</span>
      </div>
      <div class="card-entity-title">${p.entidad || "Entidad"}</div>
      <div class="card-budget-row"><span class="card-budget-value">${precio}</span></div>
      <div class="card-reason-line">${p.reason}</div>
    `;

    card.addEventListener("click", () => selectProcess(p));
    container.appendChild(card);
  });
}

// --------------------------------------------------------------------------
// 6. FILTERS & SEARCH
// --------------------------------------------------------------------------
function initFilters() {
  document.querySelectorAll(".filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      currentFilter = pill.getAttribute("data-filter");
      renderTriageList();
    });
  });
}

function initSearch() {
  const searchInput = document.getElementById("triage-search-input");
  searchInput.addEventListener("input", () => {
    renderTriageList();
  });
}

// --------------------------------------------------------------------------
// 7. SLIDE-OVER DRAWER (PERFIL EMPRESARIAL & RUP)
// --------------------------------------------------------------------------
function initDrawer() {
  const openBtn = document.getElementById("open-drawer-btn");
  const closeBtn = document.getElementById("close-drawer-btn");
  const backdrop = document.getElementById("drawer-backdrop");

  openBtn.addEventListener("click", () => {
    backdrop.classList.add("open");
  });

  closeBtn.addEventListener("click", () => {
    backdrop.classList.remove("open");
  });

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      backdrop.classList.remove("open");
    }
  });

  // ESC key closes drawer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop.classList.contains("open")) {
      backdrop.classList.remove("open");
    }
  });
}

function renderCompanyDrawer(perfil, ind) {
  if (!perfil || !ind) return;

  // Header button company label
  const headerName = perfil.razon_social ? perfil.razon_social.split(" ")[0] + " S.A.S." : "Pacífico S.A.S.";
  document.getElementById("header-company-name").textContent = headerName;

  // Drawer Specimen Card
  document.getElementById("drawer-comp-name").textContent = perfil.razon_social || "Ingeniería y Mantenimiento del Pacífico S.A.S.";
  document.getElementById("drawer-comp-nit").textContent = `NIT: ${perfil.nit}`;
  document.getElementById("drawer-comp-city").textContent = `${perfil.ciudad}, ${perfil.departamento}`;
  document.getElementById("drawer-comp-activity").textContent = perfil.actividad;

  // Drawer Financial Indicators
  document.getElementById("drawer-val-capital").textContent = formatCOP(ind.capital_de_trabajo);
  document.getElementById("drawer-val-liquidez").textContent = ind.indice_liquidez;
  document.getElementById("drawer-val-endeudamiento").textContent = `${ind.indice_endeudamiento_pct}%`;
  document.getElementById("drawer-val-cobertura").textContent = `${ind.razon_cobertura_intereses}x`;

  // UNSPSC Tags in Drawer
  const tagsContainer = document.getElementById("drawer-unspsc-tags");
  tagsContainer.innerHTML = "";
  (perfil.rup?.codigos_unspsc || []).forEach(cod => {
    const tag = document.createElement("span");
    tag.className = "code-tag";
    tag.textContent = cod;
    tagsContainer.appendChild(tag);
  });

  // Certified Experience in Drawer
  const expContainer = document.getElementById("drawer-exp-list");
  expContainer.innerHTML = "";
  (perfil.experiencia || []).forEach(exp => {
    const item = document.createElement("div");
    item.className = "exp-item";
    const id = exp.id || exp.id_contrato || "EXP";
    const year = exp.anio || exp.ano || "";
    const valor = exp.valor || exp.valor_cop || 0;
    item.innerHTML = `
      <div class="exp-item-top">
        <span class="exp-id">${id} · ${year}</span>
        <span class="exp-amount tabular-nums">${formatCOP(valor)}</span>
      </div>
      <div class="exp-client">${exp.contratante}</div>
      <div class="exp-desc">${exp.objeto}</div>
    `;
    expContainer.appendChild(item);
  });
}
