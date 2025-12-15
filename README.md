# Proyecto VRP — Demo de Ruteo Vehicular

Descripción

- Propósito: demo navegable (frontend) para resolver variantes del problema de ruteo de vehículos (VRP) con heurísticas clásicas, visualizar rutas en un mapa y exportar resultados.
- Tecnologías: HTML/CSS/JavaScript (vanilla), Leaflet para visualización de mapas, OpenRouteService (ORS) para matriz de distancias y trazado de rutas.

Estructura del repositorio

- `index.html` — página principal que carga Leaflet y `main.js`.
- `main.js` — lógica completa: carga de casos, validaciones, heurísticas (Nearest Neighbor, Clarke-Wright Savings), mejora 2-Opt, llamadas a ORS, visualización y exportación.
- `assets/styles.css` — estilos.
- `assets/icons/` — iconos locales: `marker-icon.png`, `marker-icon-red.png`
- `json-casos/` — ejemplos de casos JSON (p. ej. `caso_estudio_GC.json`, `caso_estudio_original.json`).
- `PDFs/` — documentación y material de apoyo (consultar para detalles teóricos y especificaciones).

Formato esperado de los casos JSON

El archivo JSON que se carga debe tener la siguiente estructura (ejemplo mínimo):

```
{
  "depot": { "lat": -32.89084, "lng": -68.82717 },
  "destinations": [
    { "id": "C1", "lat": -32.89, "lng": -68.83, "demand": 10 },
    { "id": "C2", "lat": -32.88, "lng": -68.82, "demand": 5 }
  ],
  "numVehicles": 3,
  "vehicleCapacity": 50,
  "avgSpeed": 40,            // km/h (opcional, usado para estimar tiempos)
  "fuelConsumption": 8      // L por cada 100 km
}
```

- `depot`: objeto con `lat` y `lng`.
- `destinations`: array de clientes, cada uno con `id`, `lat`, `lng` y `demand`.
- `numVehicles`, `vehicleCapacity`, `avgSpeed`, `fuelConsumption`: parámetros del problema.

Lógica del código (`main.js`) — resumen alto nivel

- Carga y validación de casos JSON: comprueba campos mínimos y actualiza marcadores en el mapa.
- Cálculo de matrices: llama al endpoint `v2/matrix/driving-car` de OpenRouteService para obtener matrices de distancia (`distanceMatrix`) y duración (`timeMatrix`).
- Heurísticas implementadas:
  - Vecino Más Cercano (Nearest Neighbor): construye rutas para cada vehículo seleccionando el cliente más cercano no visitado que entre en la capacidad.
  - Algoritmo de Ahorros (Clarke-Wright Savings): inicia con rutas unitarias [0,i,0] y combina rutas según el ahorro sij = d(0,i)+d(0,j)-d(i,j) si las capacidades lo permiten.
  - Mejora 2-Opt: aplicado opcionalmente para invertir segmentos y reducir la distancia de una ruta dada.
- Evaluación de soluciones: para cada solución/algoritmo se calcula distancia total, tiempo total (usando `avgSpeed` o `timeMatrix`), y consumo de combustible (a partir de `fuelConsumption`).
- Visualización: `visualizeRoutes` dibuja las rutas en Leaflet; el depósito utiliza un icono rojo y los clientes usan el icono por defecto.
- Exportación: los resultados (distancia, tiempo, consumo, rutas) se pueden exportar a JSON desde la interfaz.

Detalles sobre las metaheurísticas

- Nearest Neighbor

  - Constructivo, O(n^2) en implementación simple.
  - Ventaja: rápido para instancias pequeñas/medianas.
  - Inconveniente: depende del orden inicial y puede quedar en óptimos locales.

- Clarke-Wright (Savings)

  - Calcular ahorros para cada par (i,j), ordenarlos y combinar rutas si no violan restricciones.
  - Provee soluciones competitivas en tiempo razonable para muchos problemas de VRP.

- 2-Opt
  - Búsqueda local (swap de arcos) para mejorar rutas individuales.
  - Normalmente se aplica después de una solución constructiva para obtener mejoras notables.

Tablas con resultados que genera

- En la interfaz se muestra una tabla comparativa con, para cada algoritmo probado:
  - Algoritmo (nombre)
  - Distancia total (km)
  - Tiempo total (horas)
  - Consumo de combustible (litros)
  - Número de vehículos utilizados
- Además se lista la mejor solución y se muestran los detalles por ruta (secuencia de nodos y métricas por ruta).

Uso de OpenRouteService (ORS)

- Endpoints usados:
  - `/v2/matrix/driving-car` para calcular matrices de distancia y duración.
  - `/v2/directions/driving-car` para obtener geoJSON de la ruta y visualizar (tramos o ruta completa).

Configuraciones y rutas importantes

- `main.js`: cambiar la variable `apiKey` si requiere usar otra clave.
- Archivos de iconos en `assets/icons/` deben existir con los nombres:
  - `marker-icon.png` (icono por defecto para clientes)
  - `marker-icon-red.png` (icono del depósito)

Archivos de entrada de datos

- `json-casos/caso_estudio_GC.json`
- `json-casos/caso_estudio_original.json`

Posibles mejoras futuras

- Integrar APIs para consultar tránsito en tiempo real.
- Añadir más metaheurísticas o un solucionador exacto para instancias pequeñas (p. ej. OR-Tools).
- Exportar visualizaciones (PNG/SVG) y añadir comparación de múltiples instancias automáticamente.

Referencias y documentación adicional

- Revisar los PDFs en la carpeta `PDFs/` para la documentación teórica y especificaciones del caso de estudio.
- OpenRouteService: https://openrouteservice.org/
- Leaflet: https://leafletjs.com/
