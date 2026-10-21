"""Servidor Web FastAPI para la Interfaz Gráfica del Agente SECOP."""
import os
import sys
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException
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

app = FastAPI(title="Agente Analista SECOP II - UI")

# Servir archivos estáticos
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)


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


@app.get("/api/procesos")
async def get_procesos():
    """Devuelve la lista de procesos SECOP y el resumen estadístico."""
    try:
        data = h.buscar_procesos(limite=50)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=f"Error en el agente: {e}")


# Montar estáticos
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    import uvicorn
    print("\n🚀 Iniciando servidor del Agente SECOP en http://127.0.0.1:8000\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
