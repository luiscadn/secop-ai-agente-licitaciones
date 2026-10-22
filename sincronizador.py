"""Módulo de Sincronización Incremental con la API Socrata (datos.gov.co) para el Valle del Cauca."""
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional

import db_secop

BASE_DIR = Path(__file__).resolve().parent
SOCRATA_ENDPOINT = "https://www.datos.gov.co/resource/p6dx-8zbt.json"


def sincronizar_secop(
    limite: int = 100,
    forzar_completo: bool = False,
    app_token: Optional[str] = None
) -> Dict[str, Any]:
    """Ejecuta una sincronización incremental de procesos de tecnología en el Valle del Cauca.
    
    Descarga procesos públicos abiertos de SECOP II vía Socrata SODA y los almacena
    en SQLite indexados con FTS5.
    """
    token = app_token or os.getenv("SOCRATA_APP_TOKEN", "qralBEWw2CZayVYj5oDNTbvHq")
    
    # 1. Determinar marca de agua (watermark) para sincronización incremental
    db_secop.init_db()
    ultima_fecha = None
    if not forzar_completo:
        ultima_fecha = db_secop.obtener_metadata("ultima_fecha_publicacion")

    # 2. Cláusula SoQL optimizada (evita wildcards % sin URL-encode que rompen el compiler)
    condiciones = [
        "departamento_entidad = 'Valle del Cauca'",
        "estado_de_apertura_del_proceso = 'Abierto'",
        "("
        "  starts_with(codigo_principal_de_categoria, 'V1.8111') "
        "  OR starts_with(codigo_principal_de_categoria, 'V1.4323') "
        "  OR starts_with(codigo_principal_de_categoria, 'V1.8010') "
        "  OR starts_with(codigo_principal_de_categoria, 'V1.8110') "
        "  OR contains(upper(descripci_n_del_procedimiento), 'SOFTWARE') "
        "  OR contains(upper(descripci_n_del_procedimiento), 'TECNOLOG') "
        "  OR contains(upper(descripci_n_del_procedimiento), 'APLICACION') "
        "  OR contains(upper(descripci_n_del_procedimiento), 'INTELIGENCIA') "
        "  OR contains(upper(descripci_n_del_procedimiento), 'SISTEMAS') "
        "  OR contains(upper(descripci_n_del_procedimiento), 'DIGITAL') "
        "  OR contains(upper(descripci_n_del_procedimiento), 'NUBE') "
        "  OR contains(upper(descripci_n_del_procedimiento), 'OPTIMIZACION')"
        ")"
    ]

    if ultima_fecha:
        condiciones.append(f"fecha_de_publicacion_del >= '{ultima_fecha}'")

    where_clause = " AND ".join(condiciones)

    params = {
        "$where": where_clause,
        "$order": "fecha_de_publicacion_del DESC",
        "$limit": str(limite)
    }

    url = f"{SOCRATA_ENDPOINT}?{urllib.parse.urlencode(params)}"

    headers = {
        "User-Agent": "SECOP-AI-Agent-Valle/2.0",
        "Accept": "application/json"
    }
    if token:
        headers["X-App-Token"] = token

    req = urllib.request.Request(url, headers=headers)
    
    t0 = datetime.now(timezone.utc)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {
            "estado": "error",
            "mensaje": f"Error conectando con la API Socrata de datos.gov.co: {e}",
            "fecha": t0.isoformat()
        }

    # 3. Almacenar incrementalmente en SQLite
    total_nuevos_o_actualizados = db_secop.guardar_procesos(data)

    # 4. Actualizar metadatos
    ahora_iso = datetime.now(timezone.utc).isoformat()
    db_secop.guardar_metadata("ultima_sincronizacion", ahora_iso)

    fechas = [p.get("fecha_de_publicacion_del") for p in data if p.get("fecha_de_publicacion_del")]
    if fechas:
        max_fecha = max(fechas)
        db_secop.guardar_metadata("ultima_fecha_publicacion", max_fecha)

    total_en_db = db_secop.contar_procesos()
    db_secop.guardar_metadata("total_procesos_valle", str(total_en_db))

    return {
        "estado": "exitoso",
        "nuevos_o_actualizados": total_nuevos_o_actualizados,
        "total_en_base_datos": total_en_db,
        "ultima_sincronizacion": ahora_iso,
        "tiempo_segundos": round((datetime.now(timezone.utc) - t0).total_seconds(), 2)
    }


if __name__ == "__main__":
    print("\n Iniciando sincronización de prueba desde Socrata...")
    resultado = sincronizar_secop(limite=50)
    print(json.dumps(resultado, indent=2, ensure_ascii=False))
