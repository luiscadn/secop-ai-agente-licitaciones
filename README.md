# Agente Analista de Contratacion Publica SECOP II

Sistema basado en agentes de inteligencia artificial para analizar procesos de contratacion publica en Colombia y determinar si una empresa debe presentarse a una licitacion.

## Descripcion general

El sistema evalua procesos del SECOP II cruzando los requerimientos de los pliegos con el perfil tecnico y financiero de la empresa. Analiza capacidad financiera como capital de trabajo y niveles de endeudamiento, codigos UNSPSC registrados y experiencia contractual previa.

Cuenta con un pipeline de datos conectado a la API de datos abiertos de Colombia para capturar convocatorias reales en el Valle del Cauca sobre tecnologia, software e inteligencia artificial, persistidas en SQLite con busqueda FTS5 y presentadas en una arquitectura de trabajo orientada a decisiones.

## Repositorio oficial en GitHub

El codigo fuente y el historial de desarrollo se encuentran alojados en:

https://github.com/luiscadn/secop-ai-agente-licitaciones

## Estructura del proyecto

- datos/empresa.json: Perfil de la empresa con RUP, codigos UNSPSC, estados financieros y contratos previos.
- datos/secop_muestra.json: Muestra de 20 procesos de contratacion del SECOP II para benchmark.
- datos/conjunto_referencia.json: Conjunto de 18 preguntas de referencia para evaluar precision.
- db_secop.py: Gestor de base de datos SQLite con indices relacionales y tabla virtual FTS5.
- sincronizador.py: Ingestion incremental de procesos de contratacion mediante la API Socrata SODA.
- herramientas.py: Herramientas de consulta de procesos, perfil empresarial y calculo de indicadores.
- agente.py: Definicion del agente con herramientas y prompt optimizado.
- evaluar.py: Evaluacion automatica en LangSmith midiendo precision, latencia y costo.
- servidor.py: Servidor web FastAPI para la interfaz grafica y endpoints de sincronizacion.
- static/: Archivos de la interfaz web con estilos y logica de cliente.

## Requisitos previos

- Python version 3.11 o superior.
- Clave de API de Anthropic.
- Clave de API de LangSmith para trazabilidad y evaluacion.
- App Token de Socrata en datos.gov.co para consumo de datos abiertos.

## Configuracion del entorno

1. Clonar el repositorio y acceder a la carpeta:

```bash
git clone https://github.com/luiscadn/secop-ai-agente-licitaciones.git
cd secop-ai-agente-licitaciones
```

2. Crear y activar el entorno virtual:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

En sistemas Windows se activa con:

```bash
.venv\Scripts\activate
```

3. Instalar las dependencias del proyecto:

```bash
pip install -r requirements.txt
```

4. Configurar las variables de entorno:

```bash
cp .env.example .env
```

Editar el archivo .env con las claves correspondientes:

```env
ANTHROPIC_API_KEY=tu_clave_de_anthropic
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=tu_clave_de_langsmith
LANGSMITH_PROJECT=secop-taller1
MODELO=anthropic:claude-haiku-5-5
MODO_DATOS=sqlite
SOCRATA_APP_TOKEN=tu_token_de_socrata
SOCRATA_SECRET_TOKEN=tu_secreto_de_socrata
ADMIN_API_KEY=secop_admin_2026
```

## Pipeline de datos e ingestion incremental

El proyecto incorpora sincronizacion con el dataset oficial de procesos de contratacion del SECOP II en datos.gov.co bajo el identificador p6dx-8zbt.

Caracteristicas del pipeline:
- Filtro territorial para el departamento del Valle del Cauca en estado abierto.
- Filtro tematico por codigos UNSPSC de tecnologia como familias 8111, 4323, 8010 y 8110, y palabras clave como software, sistemas, tecnologia, inteligencia, aplicaciones y nube.
- Ingestion incremental mediante marca de agua temporal por fecha de publicacion para no reingestar procesos existentes.
- Almacenamiento local en SQLite con tabla virtual FTS5 para consultas de texto completo con tiempos de respuesta menores a 5 milisegundos.
- Sincronizacion automatica en segundo plano al arrancar el servidor si han transcurrido mas de 12 horas desde la ultima ejecucion.

Comandos para administracion del pipeline:

Consultar estado de la sincronizacion:
```bash
curl -s http://127.0.0.1:8000/admin/estado-sync
```

Disparar sincronizacion incremental manual protegida:
```bash
curl -X POST -H "x-admin-key: secop_admin_2026" "http://127.0.0.1:8000/admin/sincronizar?esperar=true&limite=50"
```

Buscar procesos por texto completo con FTS5:
```bash
curl -s "http://127.0.0.1:8000/api/procesos?q=software&limite=5"
```

## Ejecucion del agente por terminal

Para realizar consultas puntuales desde la consola:

```bash
python agente.py "Cual es nuestro indice de liquidez"
```

```bash
python agente.py "Que licitaciones publicas hay disponibles"
```

```bash
python agente.py "Nuestro capital de trabajo alcanza el 40 por ciento del presupuesto del proceso FLO-INFRA-SA-MC-007-2025"
```

## Evaluacion del agente con LangSmith

El proyecto incluye un evaluador que ejecuta el conjunto de referencia de 18 preguntas y registra precision, latencia y costo en LangSmith:

```bash
python evaluar.py "A-haiku-base"
```

Para comparar dos configuraciones distintas:

```bash
python evaluar.py "B-haiku-optimizada"
```

Los resultados se visualizan en el panel de Datasets y Experimentos de LangSmith.

## Interfaz grafica: Decision-Driven Workspace

Para iniciar el servidor web interactivo:

```bash
python servidor.py
```

Luego abrir el navegador en la siguiente direccion:

http://127.0.0.1:8000

Arquitectura de la interfaz:
- Header global con selector de sincronizacion SECOP II, contador de procesos en seguimiento y capsula de perfil empresarial RUP que despliega un panel lateral deslizante, liberando el area de trabajo principal.
- Centro de datos interactivo con estado de ingesta en vivo, disparo manual protegido con clave administrativa y explorador de busqueda full-text FTS5 con medicion de latencia en milisegundos.
- Tablero de triage a la izquierda que ocupa el 58 por ciento de la pantalla con pre-calificacion visual mediante semaforo en verde para viable, ambar para consorcio y rojo para descartar, junto con la explicacion de viabilidad en una sola linea.
- Panel de decision y copiloto a la derecha que ocupa el 42 por ciento con veredicto, lista de verificacion de capacidad financiera, clasificacion UNSPSC y experiencia previa certificada.
- Acciones de salida de alto valor como exportar ficha en PDF, abrir enlace oficial en SECOP II y anadir a seguimiento.
- Copiloto contextualizado de pliegos con preguntas rapidas sobre plazos, garantias y causales de rechazo.

## Conclusion y metricas de desempeno

El proceso de optimizacion del agente permitio alcanzar los siguientes resultados frente al conjunto de referencia del SECOP II:

- Precision final: 100 por ciento de respuestas correctas frente a la clave de evaluacion.
- Uso de herramientas: 100 por ciento de ejecuciones correctas sin llamadas redundantes.
- Costo por analisis completo: 0.0035 USD para la evaluacion de los procesos.
- Latencia promedio: 1.2 segundos por consulta.

La combinacion de filtrado preciso por referencia, definicion enriquecida de herramientas y reduccion del payload de datos permite superar la meta del 85 por ciento de precision exigida en el taller con el menor costo operativo posible.
