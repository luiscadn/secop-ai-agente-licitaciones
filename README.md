# Agente Analista de Contratacion Publica SECOP II

Sistema basado en agentes de inteligencia artificial para analizar procesos de contratacion publica en Colombia y determinar si una empresa debe presentarse a una licitacion.

## Descripcion general

El sistema evalua procesos del SECOP II cruzando los requerimientos de los pliegos con el perfil tecnico y financiero de la empresa. Analiza capacidad financiera como capital de trabajo y niveles de endeudamiento, codigos UNSPSC registrados y experiencia contractual previa.

## Estructura del proyecto

- datos/empresa.json: Perfil de la empresa con RUP, codigos UNSPSC, estados financieros y contratos previos.
- datos/secop_muestra.json: Muestra de 20 procesos de contratacion del SECOP II.
- datos/conjunto_referencia.json: Conjunto de 18 preguntas de referencia para evaluar precision.
- herramientas.py: Herramientas de consulta de procesos, perfil empresarial y calculo de indicadores.
- agente.py: Definicion del agente con herramientas y prompt optimizado.
- evaluar.py: Evaluacion automatica en LangSmith midiendo precision, latencia y costo.
- servidor.py: Servidor web FastAPI para la interfaz grafica.
- static/: Archivos de la interfaz web con estilos y logica de cliente.

## Requisitos previos

- Python version 3.11 o superior.
- Clave de API de Anthropic.
- Clave de API de LangSmith para trazabilidad y evaluacion.

## Configuracion del entorno

1. Clonar el repositorio y acceder a la carpeta:

```bash
git clone https://github.com/luiscadn/taller_agente.git
cd taller_agente
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
MODO_DATOS=muestra
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

## Ejecucion de la interfaz grafica web

Para iniciar el servidor web interactivo:

```bash
python servidor.py
```

Luego abrir el navegador en la siguiente direccion:

http://127.0.0.1:8000

La interfaz permite:
- Visualizar los indicadores financieros y codigos UNSPSC de la empresa.
- Explorar los 20 procesos de contratacion con busqueda en tiempo real.
- Analizar la viabilidad de presentarse a cada proceso con un solo clic.
- Inspeccionar las herramientas ejecutadas, la latencia y el costo estimado de cada respuesta.
