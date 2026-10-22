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

// Company Financial State (Reactive to Company Profile)
let workingCapital = 182000000; // $182.0M COP default
let companyUnspsc = ["72141000", "81101500", "72101500", "72152700", "72102900"];

document.addEventListener("DOMContentLoaded", () => {
  initDrawer();
  initCompanyEditor();
  initFilters();
  initSearch();
  initTracking();
  initCopilotChat();
  initSyncCenter();
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
      if (companyIndicators?.capital_de_trabajo) {
        workingCapital = companyIndicators.capital_de_trabajo;
      }
      if (companyProfile?.rup?.codigos_unspsc) {
        companyUnspsc = companyProfile.rup.codigos_unspsc;
      }
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
  const unspscMatch = companyUnspsc.some(c => categoria.startsWith(c.substring(0, 4)) || c.startsWith(categoria.substring(0, 4)));

  // Calculate total certified experience in company profile
  const totalExp = (companyProfile?.experiencia || []).reduce((acc, e) => acc + (parseFloat(e.valor) || 0), 0);
  const expLabel = totalExp > 0 
    ? `Acredita contratos afines certificados por ${formatCOP(totalExp)}.` 
    : "Sin experiencia contractual registrada en perfil.";
  let expCheck = { status: totalExp > 0 ? "ok" : "warn", label: "Experiencia Contractual", desc: expLabel };

  let status = "review"; // "go" | "review" | "nogo"
  let score = 75;
  let verdictTitle = "REVISAR · REQUIERE CONSORCIO O ALIANZA";
  let reason = "";
  let financialCheck = { status: "warn", label: "Capacidad Financiera", desc: "" };
  let unspscCheck = { status: "warn", label: "Clasificación UNSPSC", desc: "" };

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
  // Rule 2: Presupuesto accesible cubierto ampliamente por capital
  else if (precio <= workingCapital * 1.1) {
    const coverage = ((workingCapital / precio) * 100).toFixed(0);
    status = "go";
    score = Math.min(96, 88 + (coverage > 100 ? 8 : 0));
    verdictTitle = `VIABLE · GO (${score}% MATCH HABILITANTE)`;
    reason = `Capital de trabajo disponible (${formatCOP(workingCapital)}) cubre el ${coverage}% del presupuesto oficial.`;
    financialCheck = { status: "ok", label: "Capacidad Financiera", desc: `Capital disponible cubre holgadamente el ${coverage}% del valor oficial.` };
    unspscCheck = { status: unspscMatch ? "ok" : "warn", label: "Clasificación UNSPSC", desc: unspscMatch ? "Código UNSPSC registrado en RUP de la empresa." : "Verificar afinidad de código en pliegos." };
  }
  // Rule 3: Presupuesto intermedio (entre 1.1x y 2.1x el capital de trabajo)
  else if (precio <= workingCapital * 2.1) {
    const coverage = ((workingCapital / precio) * 100).toFixed(1);
    status = "review";
    score = 78;
    verdictTitle = "VIABLE CON CONSORCIO O UNIÓN TEMPORAL";
    reason = `Capital cubre el ${coverage}% del presupuesto. Se recomienda consorcio para alcanzar el 100% exigido.`;
    financialCheck = { status: "warn", label: "Capacidad Financiera", desc: `Capital (${formatCOP(workingCapital)}) cubre el ${coverage}% del contrato. Requiere socio consorcial.` };
    unspscCheck = { status: unspscMatch ? "ok" : "warn", label: "Clasificación UNSPSC", desc: unspscMatch ? "Código UNSPSC registrado en RUP." : "Verificar código de categoría en pliegos definitivos." };
  }
  // Rule 4: Presupuestos muy grandes (> 2.1x el capital)
  else {
    const coverage = ((workingCapital / precio) * 100).toFixed(1);
    status = "nogo";
    score = 48;
    verdictTitle = "NO RECOMENDADO INDIVIDUAL (EXCEDE CAPACIDAD)";
    reason = `Presupuesto elevado (${formatCOP(precio)}). Tu capital de trabajo (${formatCOP(workingCapital)}) cubre solo el ${coverage}%.`;
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

// --------------------------------------------------------------------------
// 7. INTERACTIVE COMPANY PROFILE EDITOR
// --------------------------------------------------------------------------
function initCompanyEditor() {
  const toggleBtn = document.getElementById("toggle-edit-profile-btn");
  const cancelBtn = document.getElementById("btn-cancel-edit-profile");
  const viewMode = document.getElementById("drawer-view-mode");
  const editMode = document.getElementById("drawer-edit-mode");
  const editLabel = document.getElementById("edit-toggle-label");
  const form = document.getElementById("form-edit-empresa");
  const addContractBtn = document.getElementById("btn-add-contract-row");
  const contractsContainer = document.getElementById("edit-contracts-container");
  const statusMsg = document.getElementById("save-profile-status");

  let isEditing = false;
  let formContracts = [];

  function setEditMode(editing) {
    isEditing = editing;
    if (editing) {
      viewMode.style.display = "none";
      editMode.style.display = "block";
      toggleBtn.classList.add("active");
      editLabel.textContent = "Ver Perfil";
      populateForm();
    } else {
      viewMode.style.display = "block";
      editMode.style.display = "none";
      toggleBtn.classList.remove("active");
      editLabel.textContent = "Editar Perfil";
      statusMsg.style.display = "none";
    }
  }

  toggleBtn.addEventListener("click", () => {
    setEditMode(!isEditing);
  });

  cancelBtn.addEventListener("click", () => {
    setEditMode(false);
  });

  function populateForm() {
    if (!companyProfile) return;
    document.getElementById("input-razon-social").value = companyProfile.razon_social || "";
    document.getElementById("input-nit").value = companyProfile.nit || "";
    document.getElementById("input-ciudad").value = companyProfile.ciudad || "";
    document.getElementById("input-departamento").value = companyProfile.departamento || "";
    document.getElementById("input-tamano").value = companyProfile.tamano || "Pequeña empresa";
    document.getElementById("input-actividad").value = companyProfile.actividad || "";

    const ef = companyProfile.estados_financieros || {};
    document.getElementById("input-activo-corriente").value = ef.activo_corriente || 442000000;
    document.getElementById("input-pasivo-corriente").value = ef.pasivo_corriente || 260000000;
    document.getElementById("input-activo-total").value = ef.activo_total || 1150000000;
    document.getElementById("input-pasivo-total").value = ef.pasivo_total || 713000000;
    document.getElementById("input-patrimonio").value = ef.patrimonio || 437000000;
    document.getElementById("input-utilidad-operacional").value = ef.utilidad_operacional || 46000000;
    document.getElementById("input-gastos-intereses").value = ef.gastos_de_intereses || 18400000;

    const unspscArr = companyProfile.rup?.codigos_unspsc || [];
    document.getElementById("input-unspsc").value = unspscArr.join(", ");

    formContracts = JSON.parse(JSON.stringify(companyProfile.experiencia || []));
    renderEditContracts();
    updateLiveKpi();
  }

  // Live KPI preview recalculation
  function updateLiveKpi() {
    const ac = parseFloat(document.getElementById("input-activo-corriente").value) || 0;
    const pc = parseFloat(document.getElementById("input-pasivo-corriente").value) || 0;
    const at = parseFloat(document.getElementById("input-activo-total").value) || 0;
    const pt = parseFloat(document.getElementById("input-pasivo-total").value) || 0;

    const cap = ac - pc;
    const liq = pc > 0 ? (ac / pc).toFixed(2) : "0.00";
    const end = at > 0 ? ((pt / at) * 100).toFixed(1) : "0.0";

    document.getElementById("live-kpi-capital").textContent = formatCOP(cap);
    document.getElementById("live-kpi-liquidez").textContent = liq;
    document.getElementById("live-kpi-endeudamiento").textContent = `${end}%`;
  }

  // Attach live calculation to inputs
  ["input-activo-corriente", "input-pasivo-corriente", "input-activo-total", "input-pasivo-total"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateLiveKpi);
  });

  // Quick chips click
  document.querySelectorAll(".quick-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const code = chip.dataset.code;
      const input = document.getElementById("input-unspsc");
      const current = input.value.split(",").map(c => c.trim()).filter(Boolean);
      if (!current.includes(code)) {
        current.push(code);
        input.value = current.join(", ");
      }
    });
  });

  // Add contract row
  addContractBtn.addEventListener("click", () => {
    formContracts.push({
      id: `EXP-${formContracts.length + 1}`,
      contratante: "",
      objeto: "",
      anio: new Date().getFullYear(),
      valor: 100000000,
      codigos_unspsc: ["81111500"]
    });
    renderEditContracts();
  });

  function renderEditContracts() {
    contractsContainer.innerHTML = "";
    formContracts.forEach((exp, idx) => {
      const card = document.createElement("div");
      card.className = "contract-edit-card";
      card.innerHTML = `
        <div class="contract-edit-header">
          <span>Contrato #${idx + 1} (${exp.id || 'EXP'})</span>
          <button type="button" class="btn-remove-contract" data-idx="${idx}">✕ Eliminar</button>
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">Cliente / Entidad</label>
            <input type="text" class="drawer-input contract-field" data-idx="${idx}" data-field="contratante" value="${exp.contratante || ''}" placeholder="Ej: Alcaldía de Cali" required>
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Año</label>
              <input type="number" class="drawer-input contract-field" data-idx="${idx}" data-field="anio" value="${exp.anio || 2024}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Valor (COP)</label>
              <input type="number" class="drawer-input contract-field" data-idx="${idx}" data-field="valor" value="${exp.valor || 0}" required>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Objeto del Contrato</label>
          <input type="text" class="drawer-input contract-field" data-idx="${idx}" data-field="objeto" value="${exp.objeto || ''}" placeholder="Descripción del servicio prestado" required>
        </div>
      `;
      contractsContainer.appendChild(card);
    });

    // Delete buttons
    contractsContainer.querySelectorAll(".btn-remove-contract").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.dataset.idx);
        formContracts.splice(idx, 1);
        renderEditContracts();
      });
    });

    // Input listeners for contract fields
    contractsContainer.querySelectorAll(".contract-field").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = parseInt(e.target.dataset.idx);
        const field = e.target.dataset.field;
        let val = e.target.value;
        if (field === "anio" || field === "valor") {
          val = parseFloat(val) || 0;
        }
        if (formContracts[idx]) {
          formContracts[idx][field] = val;
        }
      });
    });
  }

  // Handle Form Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("btn-submit-profile");
    submitBtn.disabled = true;
    submitBtn.textContent = "Guardando...";

    try {
      const unspscList = document.getElementById("input-unspsc").value
        .split(",")
        .map(c => c.trim().replace(/^V\d+\./, ""))
        .filter(c => c.length >= 4);

      const ac = parseFloat(document.getElementById("input-activo-corriente").value) || 0;
      const pc = parseFloat(document.getElementById("input-pasivo-corriente").value) || 0;
      const at = parseFloat(document.getElementById("input-activo-total").value) || 0;
      const pt = parseFloat(document.getElementById("input-pasivo-total").value) || 0;
      const pat = parseFloat(document.getElementById("input-patrimonio").value) || 0;
      const uo = parseFloat(document.getElementById("input-utilidad-operacional").value) || 0;
      const gi = parseFloat(document.getElementById("input-gastos-intereses").value) || 0;

      const newCompanyData = {
        razon_social: document.getElementById("input-razon-social").value.trim(),
        nit: document.getElementById("input-nit").value.trim(),
        ciudad: document.getElementById("input-ciudad").value.trim(),
        departamento: document.getElementById("input-departamento").value.trim(),
        tamano: document.getElementById("input-tamano").value,
        actividad: document.getElementById("input-actividad").value.trim(),
        rup: {
          vigente: true,
          fecha_renovacion: companyProfile?.rup?.fecha_renovacion || "2026-03-15",
          codigos_unspsc: unspscList
        },
        estados_financieros: {
          corte: companyProfile?.estados_financieros?.corte || "2025-12-31",
          moneda: "COP",
          activo_corriente: ac,
          pasivo_corriente: pc,
          activo_total: at,
          pasivo_total: pt,
          patrimonio: pat,
          utilidad_operacional: uo,
          gastos_de_intereses: gi,
          utilidad_neta: Math.max(0, uo - gi)
        },
        experiencia: formContracts
      };

      const res = await fetch("/api/empresa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCompanyData)
      });

      if (!res.ok) {
        throw new Error("No se pudo guardar el perfil empresarial");
      }

      const resData = await res.json();
      companyProfile = resData.perfil;
      companyIndicators = resData.indicadores;
      workingCapital = companyIndicators.capital_de_trabajo;
      companyUnspsc = companyProfile.rup.codigos_unspsc;

      // Update Drawer View Mode
      renderCompanyDrawer(companyProfile, companyIndicators);

      // Re-evaluate entire triage across all tenders
      allProcesses = allProcesses.map(p => evaluateProcessTriage(p));
      updateTriageCounts();
      renderTriageList();

      // If active process, re-render detail view with new scores
      if (activeProcess) {
        const updatedActive = allProcesses.find(p => (p.referencia_del_proceso || p.id_del_proceso) === (activeProcess.referencia_del_proceso || activeProcess.id_del_proceso));
        if (updatedActive) selectProcess(updatedActive);
      }

      statusMsg.className = "save-status-msg success";
      statusMsg.textContent = "Perfil empresarial guardado exitosamente. Tablero de viabilidad recalculado.";
      statusMsg.style.display = "block";

      setTimeout(() => {
        setEditMode(false);
      }, 1200);

    } catch (err) {
      statusMsg.className = "save-status-msg error";
      statusMsg.textContent = `Error: ${err.message}`;
      statusMsg.style.display = "block";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Guardar Perfil Empresarial";
    }
  });
}

// ==========================================================================
// 8. DATA CENTER: SYNC STATUS, PROTECTED TRIGGER & FTS5 EXPLORER
// ==========================================================================

function initSyncCenter() {
  const openBtn = document.getElementById("open-sync-modal-btn");
  const closeBtn = document.getElementById("close-sync-modal-btn");
  const backdrop = document.getElementById("sync-modal-backdrop");
  const refreshBtn = document.getElementById("btn-refresh-sync-status");
  const form = document.getElementById("sync-trigger-form");
  const adminKeyInput = document.getElementById("sync-input-admin-key");
  const togglePwdBtn = document.getElementById("btn-toggle-sync-pwd");
  const limitSelect = document.getElementById("sync-select-limit");
  const forceChk = document.getElementById("sync-chk-force");
  const executeBtn = document.getElementById("btn-execute-sync");
  const actionBanner = document.getElementById("sync-action-banner");

  // FTS5 elements
  const ftsInput = document.getElementById("sync-fts-input");
  const ftsBtn = document.getElementById("btn-run-fts-search");
  const ftsChips = document.querySelectorAll(".sync-chip");
  const ftsContainer = document.getElementById("sync-fts-results-container");
  const ftsMeta = document.getElementById("sync-fts-results-meta");
  const applyBoardBtn = document.getElementById("btn-apply-fts-to-board");

  if (!openBtn || !backdrop) return;

  // Initial status check to update header badge on app startup
  fetchSyncStatus();

  // Open modal
  openBtn.addEventListener("click", () => {
    backdrop.classList.add("open");
    fetchSyncStatus();
    // Default FTS5 search on first open if container empty
    if (!ftsContainer.hasChildNodes() || ftsContainer.children.length === 0) {
      runFtsSearch(ftsInput.value || "software");
    }
  });

  // Close modal
  closeBtn.addEventListener("click", () => {
    backdrop.classList.remove("open");
  });

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      backdrop.classList.remove("open");
    }
  });

  // ESC key closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop.classList.contains("open")) {
      backdrop.classList.remove("open");
    }
  });

  // Password toggle
  if (togglePwdBtn && adminKeyInput) {
    togglePwdBtn.addEventListener("click", () => {
      const isPwd = adminKeyInput.type === "password";
      adminKeyInput.type = isPwd ? "text" : "password";
      togglePwdBtn.style.color = isPwd ? "#ffffff" : "#727a74";
    });
  }

  // Refresh status button
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchSyncStatus(true);
    });
  }

  // Protected Manual Sync Execution
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const adminKey = adminKeyInput.value.trim();
      const limit = parseInt(limitSelect.value) || 50;
      const force = forceChk.checked;

      if (!adminKey) {
        showBanner("error", "Por favor ingresa la clave administrativa.");
        return;
      }

      // UI Loading state
      executeBtn.disabled = true;
      executeBtn.innerHTML = `
        <span class="sync-spinner" style="display:inline-block; animation: pulseSync 0.8s infinite;">⚡</span>
        <span>Conectando con Socrata...</span>
      `;
      const liveDot = document.getElementById("sync-live-dot");
      if (liveDot) liveDot.className = "sync-live-dot syncing";

      showBanner("loading", "Sincronizando con SECOP II (p6dx-8zbt)... Descargando contratos abiertos y re-indexando SQLite FTS5.");

      try {
        const res = await fetch(`/admin/sincronizar?esperar=true&limite=${limit}&forzar=${force}`, {
          method: "POST",
          headers: {
            "x-admin-key": adminKey
          }
        });

        const resData = await res.json();

        if (!res.ok) {
          throw new Error(resData.detail || "Error en la sincronización.");
        }

        const msg = `Sincronización exitosa: ${resData.nuevos_o_actualizados} procesos procesados en ${resData.tiempo_segundos}s. Total en base de datos: ${resData.total_en_base_datos}. Tablero principal actualizado automáticamente.`;
        showBanner("success", msg);

        // Refresh metadata and main board
        await fetchSyncStatus();
        await loadData();

      } catch (err) {
        showBanner("error", `Fallo de sincronización: ${err.message}`);
      } finally {
        executeBtn.disabled = false;
        executeBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          <span>Sincronizar Ahora con Socrata</span>
        `;
      }
    });
  }

  function showBanner(type, text) {
    if (!actionBanner) return;
    actionBanner.className = `sync-action-banner ${type}`;
    actionBanner.textContent = text;
    actionBanner.style.display = "block";
  }

  // FTS5 search handlers
  if (ftsBtn && ftsInput) {
    ftsBtn.addEventListener("click", () => {
      runFtsSearch(ftsInput.value);
    });

    ftsInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runFtsSearch(ftsInput.value);
      }
    });
  }

  ftsChips.forEach(chip => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-query");
      if (ftsInput) ftsInput.value = q;
      runFtsSearch(q);
    });
  });

  if (applyBoardBtn) {
    applyBoardBtn.addEventListener("click", () => {
      const q = (ftsInput?.value || "").trim();
      const mainSearch = document.getElementById("triage-search-input");
      if (mainSearch && q) {
        mainSearch.value = q;
        renderTriageList();
      }
      backdrop.classList.remove("open");
    });
  }

  async function runFtsSearch(query) {
    const q = (query || "").trim();
    if (!ftsContainer) return;

    ftsContainer.innerHTML = `
      <div style="color: #9ba39d; font-size: 0.72rem; padding: 12px; text-align: center;">
        Consultando tabla virtual SQLite FTS5...
      </div>
    `;

    const t0 = performance.now();
    try {
      const endpoint = q ? `/api/procesos?q=${encodeURIComponent(q)}&limite=15` : `/api/procesos?limite=15`;
      const res = await fetch(endpoint);
      const elapsed = (performance.now() - t0).toFixed(1);

      if (!res.ok) throw new Error("Error en consulta FTS5");
      const data = await res.json();
      const list = data.procesos || [];

      if (ftsMeta) {
        ftsMeta.textContent = `${list.length} resultados encontrados en ${elapsed} ms (SQLite FTS5 BM25)`;
      }

      if (applyBoardBtn) {
        applyBoardBtn.style.display = list.length > 0 ? "inline-block" : "none";
      }

      if (list.length === 0) {
        ftsContainer.innerHTML = `
          <div style="color: #727a74; font-size: 0.72rem; padding: 14px; text-align: center;">
            No se encontraron coincidencias para "${q}". Intenta con otros términos afines.
          </div>
        `;
        return;
      }

      ftsContainer.innerHTML = "";
      list.forEach(proc => {
        const row = document.createElement("div");
        row.className = "fts-result-row";
        const ref = proc.referencia_del_proceso || proc.id_del_proceso;
        const val = parseFloat(proc.precio_base) || 0;
        const precioFmt = val > 0 ? formatCOP(val) : "$0";
        const descSnippet = (proc.descripci_n_del_procedimiento || "Sin descripción").substring(0, 95);

        row.innerHTML = `
          <div class="fts-result-info">
            <div class="fts-result-title">
              <span class="fts-result-id">${ref}</span>
              <span>·</span>
              <span style="color: #ffffff;">${proc.entidad || "Entidad"}</span>
              <span style="color: #727a74; font-size: 0.65rem;">(${proc.ciudad_entidad || "Valle"})</span>
            </div>
            <div class="fts-result-desc" title="${proc.descripci_n_del_procedimiento || ''}">
              ${descSnippet}...
            </div>
          </div>
          <div class="fts-result-actions">
            <span class="fts-result-budget">${precioFmt}</span>
            <button type="button" class="btn-fts-select" title="Ver en el tablero principal">
              Ver &rarr;
            </button>
          </div>
        `;

        const selectBtn = row.querySelector(".btn-fts-select");
        selectBtn.addEventListener("click", () => {
          // Select and highlight on main board
          backdrop.classList.remove("open");
          const target = allProcesses.find(p => (p.referencia_del_proceso || p.id_del_proceso) === ref);
          if (target) {
            selectProcess(target);
          } else {
            // If not in currently loaded processes, set in main search
            const mainSearch = document.getElementById("triage-search-input");
            if (mainSearch) {
              mainSearch.value = ref;
              renderTriageList();
            }
          }
        });

        ftsContainer.appendChild(row);
      });

    } catch (err) {
      if (ftsMeta) ftsMeta.textContent = "Error al ejecutar consulta FTS5";
      ftsContainer.innerHTML = `
        <div style="color: #fb7185; font-size: 0.72rem; padding: 12px; text-align: center;">
          ${err.message}
        </div>
      `;
    }
  }

  async function fetchSyncStatus(isUserRefresh = false) {
    try {
      const res = await fetch("/admin/estado-sync");
      if (!res.ok) return;
      const data = await res.json();

      const totalEl = document.getElementById("sync-kpi-total");
      const headerBadge = document.getElementById("sync-header-badge");
      const freshnessEl = document.getElementById("sync-kpi-freshness");
      const lastDateEl = document.getElementById("sync-kpi-last-date");
      const timeAgoEl = document.getElementById("sync-kpi-time-ago");
      const liveDot = document.getElementById("sync-live-dot");

      if (totalEl) totalEl.textContent = data.total_procesos_sqlite;
      if (headerBadge) headerBadge.textContent = `${data.total_procesos_sqlite} Proc.`;

      // Freshness
      if (freshnessEl && liveDot) {
        if (data.requiere_sincronizacion_12h) {
          freshnessEl.innerHTML = `<span class="badge-freshness warn">Requiere Ingesta</span>`;
          liveDot.className = "sync-live-dot warn";
        } else {
          freshnessEl.innerHTML = `<span class="badge-freshness ok">Al día (&lt; 12h)</span>`;
          liveDot.className = "sync-live-dot";
        }
      }

      // Last sync date
      if (data.ultima_sincronizacion) {
        const d = new Date(data.ultima_sincronizacion);
        if (lastDateEl) {
          lastDateEl.textContent = d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
        }
        if (timeAgoEl) {
          timeAgoEl.textContent = d.toLocaleDateString("es-CO", { month: "short", day: "numeric" });
        }
      } else {
        if (lastDateEl) lastDateEl.textContent = "Sin sincronizar";
        if (timeAgoEl) timeAgoEl.textContent = "Pendiente";
      }

      if (isUserRefresh && refreshBtn) {
        refreshBtn.style.color = "#10b981";
        setTimeout(() => { refreshBtn.style.color = ""; }, 800);
      }

    } catch (err) {
      console.warn("No se pudo obtener el estado de sincronización:", err);
    }
  }
}

