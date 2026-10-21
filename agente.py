"""Agente analista del SECOP - punto de partida del Taller 1.

Uso:  python agente.py "¿Qué licitaciones hay en la muestra?"
"""
import os
import sys

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.tools import tool

import herramientas as h

load_dotenv()


# TODO del equipo: mejoren estas descripciones. El modelo decide qué herramienta usar
# leyendo el docstring, así que una buena descripción mejora la precisión y baja el costo.
@tool
def buscar_procesos(referencia: str = None, entidad: str = None, departamento: str = None,
                    ciudad: str = None, modalidad: str = None, texto: str = None,
                    precio_min: float = None, precio_max: float = None,
                    fecha_desde: str = None, fecha_hasta: str = None,
                    limite: int = 20) -> dict:
    """Busca procesos de contratación en SECOP II.
    Usa 'referencia' o 'texto' para buscar por código de proceso (ej: 'SA-004-2023', 'LP-DT-CAU-003-2019', 'FLO-INFRA-SA-MC-007-2025').
    Filtros opcionales: entidad, departamento, ciudad, modalidad ('licitaci', 'directa', 'abreviada'),
    rango de precios y fechas (AAAA-MM-DD). Devuelve resumen y lista de procesos."""
    return h.buscar_procesos(entidad=entidad, departamento=departamento, ciudad=ciudad,
                             modalidad=modalidad, texto=texto, referencia=referencia,
                             precio_min=precio_min, precio_max=precio_max,
                             fecha_desde=fecha_desde, fecha_hasta=fecha_hasta, limite=limite)


@tool
def consultar_empresa() -> dict:
    """Devuelve el perfil de NUESTRA empresa: RUP, códigos UNSPSC, estados financieros y
    contratos de experiencia."""
    return h.consultar_empresa()


@tool
def calcular_indicadores(presupuesto_proceso: float = None) -> dict:
    """Calcula los indicadores financieros de NUESTRA empresa: liquidez, endeudamiento,
    cobertura de intereses, capital de trabajo y rentabilidades. Si se da el presupuesto de
    un proceso, calcula qué porcentaje de él cubre nuestro capital de trabajo."""
    return h.calcular_indicadores(presupuesto_proceso)


PROMPT = """Eres un analista experto de contratación pública colombiana (SECOP II) que asesora a una empresa.
Responde en español de forma directa, concisa y precisa.

INSTRUCCIONES CLAVE DE PRECISIÓN Y ECONOMÍA:
1. Responde puntualmente a lo que se pregunta, sin rodeos, introducciones de cortesía ni despedidas o sugerencias no solicitadas.
2. Si te preguntan por un proceso específico por su referencia o código (ej: SA-004-2023, LP-DT-CAU-003-2019, FLO-INFRA-SA-MC-007-2025), búscalo usando 'referencia' o 'texto'.
3. Si un dato registrado es $0 o plazo de 0 días, indícalo expresamente como un dato inconsistente o no disponible que debe verificarse en el pliego de condiciones.
4. Para cálculos (capital de trabajo, porcentajes, suma de contratos por código UNSPSC), da la cifra exacta solicitada y la breve justificación o contratos que suman.
5. Preguntas conceptuales sobre contratación pública o qué es SECOP respóndelas directamente sin usar herramientas.
6. Cita la referencia oficial de los procesos mencionados."""

MODELO = os.getenv("MODELO", "anthropic:claude-haiku-5-5")
agente = create_agent(MODELO, tools=[buscar_procesos, consultar_empresa, calcular_indicadores],
                      system_prompt=PROMPT)


def preguntar(pregunta: str) -> dict:
    """Ejecuta el agente y devuelve la respuesta final y las herramientas que usó."""
    resultado = agente.invoke({"messages": [{"role": "user", "content": pregunta}]})
    usadas = [tc["name"] for m in resultado["messages"] for tc in (getattr(m, "tool_calls", None) or [])]
    last_msg = resultado["messages"][-1]
    if isinstance(last_msg.content, list):
        texto = "".join(b.get("text", "") for b in last_msg.content if isinstance(b, dict) and b.get("type") == "text")
    else:
        texto = str(last_msg.content)
    return {"respuesta": texto, "herramientas": usadas}



if __name__ == "__main__":
    q = " ".join(sys.argv[1:]) or "¿Cuál es nuestro índice de liquidez?"
    r = preguntar(q)
    print(r["respuesta"])
    print("\nHerramientas usadas:", r["herramientas"] or "ninguna")
