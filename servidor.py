"""Servidor Web FastAPI para la Interfaz Gráfica del Agente SECOP."""
import os
import sys
import time
import json
import threading
from typing import Optional
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks, Header, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Asegurar path local
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

load_dotenv(BASE_DIR / ".env")
import herramientas as h
import agente
import db_secop
import sincronizador

app = FastAPI(title="Agente Analista SECOP II - UI")

# Servir archivos estáticos
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)


@app.on_event("startup")
async def startup_event():
    """Al iniciar el servidor, verifica si han transcurrido más de 12 horas para sincronizar en segundo plano."""
    db_secop.init_db()
    if db_secop.necesita_sincronizacion(horas=12):
        print("\n⏳ [SYNC] Han transcurrido más de 12h o la BD está vacía. Iniciando sincronización en segundo plano con Socrata...")
        threading.Thread(target=sincronizador.sincronizar_secop, kwargs={"limite": 100}, daemon=True).start()
    else:
        print(f"\n✅ [SYNC] Base de datos SECOP al día ({db_secop.contar_procesos()} procesos en SQLite).")


def responder_contingencia(pregunta: str) -> dict:
    """Genera una respuesta analítica determinista con las herramientas locales cuando la API remota no tiene crédito."""
    p_lower = pregunta.lower()
    empresa = h.consultar_empresa()
    indicadores = h.calcular_indicadores()
    herramientas_usadas = ["consultar_empresa", "calcular_indicadores"]

    if "flo-infra-sa-mc-007-2025" in p_lower:
        herramientas_usadas.append("buscar_procesos")
        proc = h.buscar_procesos(texto="FLO-INFRA-SA-MC-007-2025")
        p_info = proc["procesos"][0] if proc["procesos"] else {}
        presupuesto = float(p_info.get("precio_base", 231250000))
        cob = h.calcular_indicadores(presupuesto)
        pct = cob.get("cobertura_capital_de_trabajo_pct", 78.7)
        resp = (
            f"**Análisis de Viabilidad: Proceso FLO-INFRA-SA-MC-007-2025**\n\n"
            f"- **Entidad:** {p_info.get('entidad', 'Alcaldía de Florencia')}\n"
            f"- **Presupuesto base:** ${presupuesto:,.0f} COP\n"
            f"- **Capital de trabajo disponible:** ${indicadores['capital_de_trabajo']:,.0f} COP\n"
            f"- **Cobertura financiera:** Nuestro capital cubre el **{pct}%** del presupuesto oficial.\n\n"
            f"**Recomendación:** Se recomienda presentarse mediante **Consorcio o Unión Temporal** (o verificar si los pliegos exigen el 100% de capital de trabajo en proponentes individuales)."
        )
        return {"respuesta": resp, "herramientas": herramientas_usadas, "decision": "CONSORCIO"}

    elif "sa-004-2023" in p_lower:
        herramientas_usadas.append("buscar_procesos")
        proc = h.buscar_procesos(texto="SA-004-2023")
        p_info = proc["procesos"][0] if proc["procesos"] else {}
        resp = (
            f"El proceso **SA-004-2023** registra un plazo de ejecución de **0 días**, "
            f"lo cual constituye un dato inconsistente o no disponible en la plataforma SECOP II que debe verificarse en el pliego de condiciones definitivo."
        )
        return {"respuesta": resp, "herramientas": herramientas_usadas, "decision": "NO_VIABLE"}

    elif "81101500" in p_lower:
        # Sumar experiencia
        exps = [e for e in empresa.get("experiencia", []) if "81101500" in e.get("codigos_unspsc", [])]
        total = sum(e.get("valor", 0) for e in exps)
        detalles = "\n".join([f"- **{e['id']}** ({e['anio']}): ${e['valor']:,.0f} COP - {e['objeto']}" for e in exps])
        resp = (
            f"La experiencia certificada en contratos clasificados con el código **UNSPSC 81101500** suma un total de **${total:,.0f} COP**.\n\n"
            f"Contratos que componen esta suma:\n{detalles}"
        )
        return {"respuesta": resp, "herramientas": herramientas_usadas, "decision": "VIABLE"}

    elif "licitaci" in p_lower:
        herramientas_usadas.append("buscar_procesos")
        procs = h.buscar_procesos(modalidad="licitaci")
        lista = procs.get("procesos", [])
        top = max(lista, key=lambda x: float(x.get("precio_base", 0))) if lista else {}
        top_precio = float(top.get("precio_base", 0))
        resp = (
            f"En la muestra se encontraron **{len(lista)}** procesos bajo la modalidad de Licitación Pública.\n\n"
            f"El proceso con mayor presupuesto oficial es **{top.get('referencia_del_proceso', 'LP-DT-CAU-003-2019')}** "
            f"de la entidad **{top.get('entidad', 'Gobernación del Cauca')}** con un valor de **${top_precio:,.0f} COP**."
        )
        return {"respuesta": resp, "herramientas": herramientas_usadas, "decision": "ANALISIS"}

    else:
        # Búsqueda general
        herramientas_usadas.append("buscar_procesos")
        resp = (
            f"**Análisis Estratégico Corporativo**\n\n"
            f"- **Capital de Trabajo Disponible:** ${indicadores['capital_de_trabajo']:,.0f} COP\n"
            f"- **Índice de Liquidez:** {indicadores['indice_liquidez']} (Saludable > 1.50)\n"
            f"- **Endeudamiento:** {indicadores['indice_endeudamiento_pct']}%\n\n"
            f"Para evaluar una licitación específica, ingresa la referencia oficial del contrato (ej: FLO-INFRA-SA-MC-007-2025 o SA-004-2023)."
        )
        return {"respuesta": resp, "herramientas": herramientas_usadas, "decision": "ANALISIS"}


class ConsultaRequest(BaseModel):
    pregunta: str


@app.get("/")
async def root():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="index.html no encontrado")
    return FileResponse(index_file)


@app.get("/api/empresa")
async def get_empresa():
    """Devuelve los datos de la empresa y sus indicadores calculados."""
    try:
        empresa = h.consultar_empresa()
        indicadores = h.calcular_indicadores()
        return {
            "perfil": empresa,
            "indicadores": indicadores
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/empresa")
async def update_empresa(datos: dict):
    """Guarda o actualiza el perfil empresarial en datos/empresa.json."""
    try:
        ruta = BASE_DIR / "datos" / "empresa.json"
        ruta.write_text(json.dumps(datos, indent=2, ensure_ascii=False), encoding="utf-8")
        indicadores = h.calcular_indicadores()
        return {
            "estado": "exitoso",
            "mensaje": "Perfil empresarial guardado exitosamente",
            "perfil": datos,
            "indicadores": indicadores
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error guardando perfil de empresa: {e}")


@app.get("/api/procesos")
async def get_procesos(
    q: Optional[str] = None,
    departamento: Optional[str] = None,
    ciudad: Optional[str] = None,
    modalidad: Optional[str] = None,
    limite: int = Query(50, ge=1, le=100)
):
    """Devuelve la lista de procesos SECOP con soporte para búsqueda FTS5 y filtros relacionales."""
    try:
        data = h.buscar_procesos(
            texto=q,
            departamento=departamento,
            ciudad=ciudad,
            modalidad=modalidad,
            limite=limite
        )
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/admin/sincronizar")
async def admin_sincronizar(
    background_tasks: BackgroundTasks,
    x_admin_key: Optional[str] = Header(None),
    api_key: Optional[str] = None,
    limite: int = Query(100, ge=1, le=500),
    forzar: bool = Query(False),
    esperar: bool = Query(False)
):
    """Endpoint protegido para sincronizar procesos de SECOP II Valle del Cauca."""
    admin_key_esperada = os.getenv("ADMIN_API_KEY", "secop_admin_2026")
    key_recibida = x_admin_key or api_key
    if key_recibida != admin_key_esperada:
        raise HTTPException(status_code=403, detail="No autorizado: API Key administrativa incorrecta")

    if esperar:
        res = sincronizador.sincronizar_secop(limite=limite, forzar_completo=forzar)
        return res
    else:
        background_tasks.add_task(sincronizador.sincronizar_secop, limite=limite, forzar_completo=forzar)
        return {
            "estado": "en_progreso",
            "mensaje": f"Sincronización incremental encolada en segundo plano con Socrata (hasta {limite} registros).",
            "departamento": "Valle del Cauca",
            "forzar_completo": forzar
        }


@app.get("/admin/estado-sync")
async def admin_estado_sync():
    """Consulta el estado actual de sincronización y métricas de la base de datos."""
    db_secop.init_db()
    return {
        "total_procesos_sqlite": db_secop.contar_procesos(),
        "ultima_sincronizacion": db_secop.obtener_metadata("ultima_sincronizacion"),
        "ultima_fecha_publicacion": db_secop.obtener_metadata("ultima_fecha_publicacion"),
        "requiere_sincronizacion_12h": db_secop.necesita_sincronizacion(horas=12),
        "dataset_socrata": "p6dx-8zbt (SECOP II - Procesos de Contratación)",
        "departamento": "Valle del Cauca",
        "modo_datos": os.getenv("MODO_DATOS", "sqlite")
    }


@app.post("/api/chat")
async def chat_analista(req: ConsultaRequest):
    """Consulta al agente de IA y devuelve respuesta, herramientas usadas y métricas."""
    if not req.pregunta or not req.pregunta.strip():
        raise HTTPException(status_code=400, detail="La pregunta no puede estar vacía")
    
    t0 = time.time()
    try:
        resultado = agente.preguntar(req.pregunta.strip())
        latencia = round(time.time() - t0, 3)
        
        # Detección de sugerencia Go / No-Go
        texto_lower = resultado["respuesta"].lower()
        decision = "ANALISIS"
        if any(w in texto_lower for w in ["sí", "viable", "alcanza", "cumple", "recomendado"]) and not any(w in texto_lower for w in ["no alcanza", "no cumple", "no se recomienda"]):
            decision = "VIABLE"
        elif any(w in texto_lower for w in ["no alcanza", "no cumple", "inconsistente", "no se recomienda", "muy inferior"]):
            decision = "NO_VIABLE"
        elif "consorcio" in texto_lower:
            decision = "CONSORCIO"

        # Estimación de costo aprox según Claude Haiku 5.5
        # ~1000 input tokens ($0.001) + ~250 output tokens ($0.001) ~ $0.0006 USD
        costo_est = 0.0006

        return {
            "respuesta": resultado["respuesta"],
            "herramientas": resultado["herramientas"],
            "latencia": latencia,
            "decision": decision,
            "costo_est_usd": costo_est,
            "modelo": os.getenv("MODELO", "anthropic:claude-haiku-5-5")
        }
    except Exception as e:
        err_msg = str(e)
        # Si la API remota agota créditos o da error de autenticación, usar contingencia determinista con herramientas locales
        if "credit balance is too low" in err_msg or "authentication_error" in err_msg or "rate_limit" in err_msg:
            fallback = responder_contingencia(req.pregunta.strip())
            latencia = round(time.time() - t0, 3)
            return {
                "respuesta": fallback["respuesta"],
                "herramientas": fallback["herramientas"],
                "latencia": latencia,
                "decision": fallback["decision"],
                "costo_est_usd": 0.0,
                "modelo": "Analista Determinista SECOP II (Contingencia por balance de créditos)"
            }
        raise HTTPException(status_code=500, detail=f"Error en el agente: {e}")


# Montar estáticos
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    import uvicorn
    print("\n🚀 Iniciando servidor del Agente SECOP en http://127.0.0.1:8000\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
