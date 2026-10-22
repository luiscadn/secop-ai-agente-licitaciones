"""Módulo de persistencia SQLite con FTS5 para Procesos del SECOP II."""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "datos" / "secop.db"


def get_connection() -> sqlite3.Connection:
    """Retorna una conexión a SQLite configurada."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON;")
    return con


def init_db():
    """Inicializa las tablas e índices relacionales y la tabla virtual FTS5."""
    with get_connection() as con:
        # 1. Tabla de metadatos de sincronización
        con.execute("""
            CREATE TABLE IF NOT EXISTS sync_metadata (
                clave TEXT PRIMARY KEY,
                valor TEXT,
                fecha_actualizacion TEXT
            );
        """)

        # 2. Tabla principal de procesos
        con.execute("""
            CREATE TABLE IF NOT EXISTS procesos (
                id_proceso TEXT PRIMARY KEY,
                referencia TEXT,
                entidad TEXT,
                nit_entidad TEXT,
                departamento TEXT,
                ciudad TEXT,
                modalidad TEXT,
                objeto TEXT,
                precio_base REAL DEFAULT 0.0,
                duracion INTEGER DEFAULT 0,
                unidad_duracion TEXT DEFAULT 'día(s)',
                estado TEXT DEFAULT 'Publicado',
                estado_apertura TEXT DEFAULT 'Abierto',
                codigo_unspsc TEXT,
                fecha_publicacion TEXT,
                fecha_sincronizacion TEXT,
                url_secop TEXT,
                raw_json TEXT
            );
        """)

        # 3. Índices para consultas relacionales y ordenamiento
        con.execute("CREATE INDEX IF NOT EXISTS idx_procesos_fecha ON procesos (fecha_publicacion DESC);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_procesos_depto ON procesos (departamento);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_procesos_ciudad ON procesos (ciudad);")
        con.execute("CREATE INDEX IF NOT EXISTS idx_procesos_precio ON procesos (precio_base);")

        # 4. Tabla virtual FTS5 para búsquedas textuales ultra rápidas
        con.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS procesos_fts USING fts5(
                id_proceso UNINDEXED,
                referencia,
                entidad,
                ciudad,
                objeto,
                codigo_unspsc,
                content='procesos',
                content_rowid='rowid'
            );
        """)

        # 5. Triggers para mantener FTS5 sincronizado con la tabla procesos
        con.execute("""
            CREATE TRIGGER IF NOT EXISTS procesos_ai AFTER INSERT ON procesos BEGIN
                INSERT INTO procesos_fts(rowid, id_proceso, referencia, entidad, ciudad, objeto, codigo_unspsc)
                VALUES (new.rowid, new.id_proceso, new.referencia, new.entidad, new.ciudad, new.objeto, new.codigo_unspsc);
            END;
        """)
        con.execute("""
            CREATE TRIGGER IF NOT EXISTS procesos_ad AFTER DELETE ON procesos BEGIN
                INSERT INTO procesos_fts(procesos_fts, rowid, id_proceso, referencia, entidad, ciudad, objeto, codigo_unspsc)
                VALUES ('delete', old.rowid, old.id_proceso, old.referencia, old.entidad, old.ciudad, old.objeto, old.codigo_unspsc);
            END;
        """)
        con.execute("""
            CREATE TRIGGER IF NOT EXISTS procesos_au AFTER UPDATE ON procesos BEGIN
                INSERT INTO procesos_fts(procesos_fts, rowid, id_proceso, referencia, entidad, ciudad, objeto, codigo_unspsc)
                VALUES ('delete', old.rowid, old.id_proceso, old.referencia, old.entidad, old.ciudad, old.objeto, old.codigo_unspsc);
                INSERT INTO procesos_fts(rowid, id_proceso, referencia, entidad, ciudad, objeto, codigo_unspsc)
                VALUES (new.rowid, new.id_proceso, new.referencia, new.entidad, new.ciudad, new.objeto, new.codigo_unspsc);
            END;
        """)


def guardar_metadata(clave: str, valor: str):
    """Guarda o actualiza un valor de metadatos."""
    ahora = datetime.now(timezone.utc).isoformat()
    with get_connection() as con:
        con.execute("""
            INSERT INTO sync_metadata (clave, valor, fecha_actualizacion)
            VALUES (?, ?, ?)
            ON CONFLICT(clave) DO UPDATE SET
                valor = excluded.valor,
                fecha_actualizacion = excluded.fecha_actualizacion;
        """, (clave, valor, ahora))


def obtener_metadata(clave: str) -> Optional[str]:
    """Obtiene el valor de un metadato."""
    with get_connection() as con:
        cur = con.execute("SELECT valor FROM sync_metadata WHERE clave = ?;", (clave,))
        row = cur.fetchone()
        return row["valor"] if row else None


def necesita_sincronizacion(horas: float = 12.0) -> bool:
    """Verifica si han transcurrido más de N horas desde la última sincronización."""
    with get_connection() as con:
        cur = con.execute("SELECT valor, fecha_actualizacion FROM sync_metadata WHERE clave = 'ultima_sincronizacion';")
        row = cur.fetchone()
        if not row or not row["fecha_actualizacion"]:
            return True
        try:
            ultima_fecha = datetime.fromisoformat(row["fecha_actualizacion"])
            ahora = datetime.now(timezone.utc)
            diferencia_horas = (ahora - ultima_fecha).total_seconds() / 3600.0
            return diferencia_horas >= horas
        except Exception:
            return True


def contar_procesos() -> int:
    """Retorna el número total de procesos almacenados en SQLite."""
    with get_connection() as con:
        cur = con.execute("SELECT COUNT(*) AS total FROM procesos;")
        return cur.fetchone()["total"]


def guardar_procesos(procesos_data: list[dict]) -> int:
    """Inserta o actualiza un lote de procesos en SQLite.
    
    Acepta tanto diccionarios normalizados como diccionarios crudos de Socrata.
    """
    if not procesos_data:
        return 0

    init_db()
    ahora = datetime.now(timezone.utc).isoformat()
    guardados = 0

    with get_connection() as con:
        for p in procesos_data:
            # Identificadores
            id_proc = p.get("referencia_del_proceso") or p.get("id_proceso") or p.get("id_del_proceso")
            if not id_proc:
                continue

            ref = p.get("referencia") or p.get("referencia_del_proceso") or id_proc
            entidad = p.get("entidad") or "Entidad no especificada"
            nit = p.get("nit_entidad") or ""
            depto = p.get("departamento") or p.get("departamento_entidad") or "Valle del Cauca"
            ciudad = p.get("ciudad") or p.get("ciudad_entidad") or p.get("ciudad_de_la_unidad_de") or "Cali"
            modalidad = p.get("modalidad") or p.get("modalidad_de_contratacion") or "Contratación directa"
            
            # Objeto contractual
            objeto = (
                p.get("objeto")
                or p.get("descripci_n_del_procedimiento")
                or p.get("nombre_del_procedimiento")
                or ""
            )

            # Precio
            raw_precio = p.get("presupuesto_cop") or p.get("precio_base") or 0.0
            try:
                precio = float(raw_precio)
            except (ValueError, TypeError):
                precio = 0.0

            # Duración
            raw_duracion = p.get("duracion_dias") or p.get("duracion") or 30
            try:
                duracion = int(raw_duracion)
            except (ValueError, TypeError):
                duracion = 30
            unidad_duracion = p.get("unidad_de_duracion") or p.get("unidad_duracion") or "día(s)"

            estado = p.get("estado") or p.get("estado_del_procedimiento") or p.get("estado_resumen") or "Publicado"
            apertura = p.get("estado_apertura") or p.get("estado_de_apertura_del_proceso") or "Abierto"
            
            # UNSPSC
            unspsc = p.get("unspsc") or p.get("codigo_unspsc") or p.get("codigo_principal_de_categoria") or ""
            unspsc = str(unspsc).replace("V1.", "").strip()

            fecha_pub = (
                p.get("fecha_publicacion")
                or p.get("fecha_de_publicacion_del")
                or ahora
            )

            # URL SECOP
            url_secop = p.get("url_secop") or ""
            if not url_secop and isinstance(p.get("urlproceso"), dict):
                url_secop = p["urlproceso"].get("url", "")

            raw_json = json.dumps(p, ensure_ascii=False)

            con.execute("""
                INSERT INTO procesos (
                    id_proceso, referencia, entidad, nit_entidad, departamento, ciudad,
                    modalidad, objeto, precio_base, duracion, unidad_duracion,
                    estado, estado_apertura, codigo_unspsc, fecha_publicacion,
                    fecha_sincronizacion, url_secop, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id_proceso) DO UPDATE SET
                    referencia = excluded.referencia,
                    entidad = excluded.entidad,
                    nit_entidad = excluded.nit_entidad,
                    departamento = excluded.departamento,
                    ciudad = excluded.ciudad,
                    modalidad = excluded.modalidad,
                    objeto = excluded.objeto,
                    precio_base = excluded.precio_base,
                    duracion = excluded.duracion,
                    unidad_duracion = excluded.unidad_duracion,
                    estado = excluded.estado,
                    estado_apertura = excluded.estado_apertura,
                    codigo_unspsc = excluded.codigo_unspsc,
                    fecha_publicacion = excluded.fecha_publicacion,
                    fecha_sincronizacion = excluded.fecha_sincronizacion,
                    url_secop = excluded.url_secop,
                    raw_json = excluded.raw_json;
            """, (
                id_proc, ref, entidad, nit, depto, ciudad,
                modalidad, objeto, precio, duracion, unidad_duracion,
                estado, apertura, unspsc, fecha_pub,
                ahora, url_secop, raw_json
            ))
            guardados += 1

    return guardados


def buscar_procesos_db(
    texto: Optional[str] = None,
    entidad: Optional[str] = None,
    departamento: Optional[str] = None,
    ciudad: Optional[str] = None,
    modalidad: Optional[str] = None,
    referencia: Optional[str] = None,
    precio_min: Optional[float] = None,
    precio_max: Optional[float] = None,
    fecha_desde: Optional[str] = None,
    fecha_hasta: Optional[str] = None,
    limite: int = 50
) -> list[dict]:
    """Busca procesos en SQLite aprovechando FTS5 para búsquedas de texto y cláusulas relacionales."""
    init_db()

    condiciones = []
    params = []

    # 1. Búsqueda de texto completo con FTS5
    if texto and texto.strip():
        tokens = [t.strip().replace('"', '""') for t in texto.strip().split() if len(t.strip()) > 1]
        if tokens:
            # Query FTS5 usando operadores booleanos
            fts_query = " ".join([f'"{tok}"*' for tok in tokens])
            condiciones.append("""
                p.rowid IN (
                    SELECT rowid FROM procesos_fts WHERE procesos_fts MATCH ?
                )
            """)
            params.append(fts_query)

    # 2. Filtros relacionales estructurados
    if referencia:
        condiciones.append("(p.referencia LIKE ? OR p.id_proceso LIKE ?)")
        patron_ref = f"%{referencia.strip()}%"
        params.extend([patron_ref, patron_ref])

    if entidad:
        condiciones.append("p.entidad LIKE ?")
        params.append(f"%{entidad.strip()}%")

    if departamento:
        condiciones.append("p.departamento LIKE ?")
        params.append(f"%{departamento.strip()}%")

    if ciudad:
        condiciones.append("p.ciudad LIKE ?")
        params.append(f"%{ciudad.strip()}%")

    if modalidad:
        condiciones.append("p.modalidad LIKE ?")
        params.append(f"%{modalidad.strip()}%")

    if precio_min is not None:
        condiciones.append("p.precio_base >= ?")
        params.append(float(precio_min))

    if precio_max is not None:
        condiciones.append("p.precio_base <= ?")
        params.append(float(precio_max))

    if fecha_desde:
        condiciones.append("p.fecha_publicacion >= ?")
        params.append(f"{fecha_desde}T00:00:00")

    if fecha_hasta:
        condiciones.append("p.fecha_publicacion <= ?")
        params.append(f"{fecha_hasta}T23:59:59")

    where_clause = f"WHERE {' AND '.join(condiciones)}" if condiciones else ""
    sql = f"""
        SELECT 
            p.id_proceso, p.referencia, p.entidad, p.nit_entidad,
            p.departamento, p.ciudad, p.modalidad, p.objeto,
            p.precio_base, p.duracion, p.unidad_duracion,
            p.estado, p.estado_apertura, p.codigo_unspsc,
            p.fecha_publicacion, p.url_secop, p.raw_json
        FROM procesos p
        {where_clause}
        ORDER BY p.fecha_publicacion DESC
        LIMIT ?;
    """
    params.append(limite)

    with get_connection() as con:
        try:
            cur = con.execute(sql, params)
            filas = cur.fetchall()
            return [dict(f) for f in filas]
        except sqlite3.OperationalError:
            # Fallback en caso de sintaxis FTS5 compleja: hacer búsqueda relacional directa con LIKE
            if texto and texto.strip():
                cond_fallback = [c for c in condiciones if "procesos_fts" not in c]
                cond_fallback.append("(p.objeto LIKE ? OR p.entidad LIKE ? OR p.referencia LIKE ?)")
                params_fallback = [p_val for c, p_val in zip(condiciones, params[:-1]) if "procesos_fts" not in c]
                t_like = f"%{texto.strip()}%"
                params_fallback.extend([t_like, t_like, t_like, limite])
                where_fb = f"WHERE {' AND '.join(cond_fallback)}" if cond_fallback else ""
                sql_fb = f"""
                    SELECT 
                        p.id_proceso, p.referencia, p.entidad, p.nit_entidad,
                        p.departamento, p.ciudad, p.modalidad, p.objeto,
                        p.precio_base, p.duracion, p.unidad_duracion,
                        p.estado, p.estado_apertura, p.codigo_unspsc,
                        p.fecha_publicacion, p.url_secop, p.raw_json
                    FROM procesos p
                    {where_fb}
                    ORDER BY p.fecha_publicacion DESC
                    LIMIT ?;
                """
                cur = con.execute(sql_fb, params_fallback)
                return [dict(f) for f in cur.fetchall()]
            raise


def obtener_todos(limite: int = 50) -> list[dict]:
    """Obtiene los procesos más recientes."""
    return buscar_procesos_db(limite=limite)
