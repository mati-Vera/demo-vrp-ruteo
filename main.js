var map;
var markers = [];
var routes = [];
var distanceMatrix = [];
var timeMatrix = [];
var destinations = [];
var depot = null;
var apiKey = "5b3ce3597851110001cf624887b16c2123524dcda1d1e157b61c63bf";
// Variables globales para configuración del problema
var numVehicles;
var vehicleCapacity;
var avgSpeed;
var fuelConsumption; //cantidad de combustible por cada 100 km

var vehicleColors = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#34495e",
  "#16a085",
  "#c0392b",
];

// Icono rojo local para el depósito
const redDepotIcon = L.icon({
  iconUrl: "assets/icons/marker-icon-red.png",
  iconAnchor: [12, 41], // Punto del icono que corresponde a la ubicación
  popupAnchor: [1, -34], // Punto desde el cual se abre el popup
});

// Helper: espera asincrónica
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch con reintentos y manejo de 429 (Retry-After / backoff exponencial)
async function fetchWithRetry(url, options = {}, maxAttempts = 5) {
  let attempt = 0;
  let delay = 500; // ms inicial

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(url, options);

      if (res.status === 429) {
        // Intentar leer Retry-After
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter ? parseFloat(retryAfter) * 1000 : delay;
        await sleep(waitMs);
        delay *= 2; // backoff exponencial
        continue;
      }

      if (!res.ok) {
        // Otros errores -> lanzar para manejo externo
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      return res;
    } catch (err) {
      // Errores de red -> reintentar con backoff
      if (attempt >= maxAttempts) throw err;
      await sleep(delay);
      delay *= 2;
    }
  }

  throw new Error("Max retry attempts reached");
}
// Inicializar el mapa
function initMap() {
  map = L.map("map").setView([-32.89084, -68.82717], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
}

// Cargar datos desde un archivo JSON
function loadFromJSONFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const caseStudyData = JSON.parse(e.target.result);

      // Validar estructura del JSON
      if (!caseStudyData.depot || !caseStudyData.destinations) {
        throw new Error(
          "El archivo JSON debe contener 'depot' y 'destinations'"
        );
      }

      // Validar que depot tenga lat y lng
      if (
        typeof caseStudyData.depot.lat !== "number" ||
        typeof caseStudyData.depot.lng !== "number"
      ) {
        throw new Error(
          "El depósito debe tener coordenadas 'lat' y 'lng' válidas (números)"
        );
      }

      // Validar que destinations sea un array
      if (
        !Array.isArray(caseStudyData.destinations) ||
        caseStudyData.destinations.length === 0
      ) {
        throw new Error(
          "'destinations' debe ser un array con al menos un cliente"
        );
      }

      // Validar cada destino
      caseStudyData.destinations.forEach((dest, index) => {
        if (typeof dest.lat !== "number" || typeof dest.lng !== "number") {
          throw new Error(
            `El cliente ${
              index + 1
            } debe tener coordenadas 'lat' y 'lng' válidas (números)`
          );
        }
        if (typeof dest.demand !== "number" || dest.demand <= 0) {
          throw new Error(
            `El cliente ${
              index + 1
            } debe tener una 'demand' válida (número positivo)`
          );
        }
        if (!dest.id) {
          throw new Error(`El cliente ${index + 1} debe tener un 'id'`);
        }
      });

      // Cargar datos en variables globales
      depot = caseStudyData.depot;
      destinations = caseStudyData.destinations;
      numVehicles = caseStudyData.numVehicles;
      vehicleCapacity = caseStudyData.vehicleCapacity;
      avgSpeed = caseStudyData.avgSpeed;
      fuelConsumption = caseStudyData.fuelConsumption;

      // Actualizar lista de destinos en la interfaz
      const destinationsList = document.getElementById("destinationsList");
      destinationsList.innerHTML = "";

      destinations.forEach((dest) => {
        const item = document.createElement("div");
        item.className = "destination-item";
        item.textContent = `Cliente ${dest.id}: [${dest.lat.toFixed(
          5
        )}, ${dest.lng.toFixed(5)}] - Demanda: ${dest.demand}`;
        destinationsList.appendChild(item);
      });

      // Actualizar el mapa
      if (map) {
        map.setView([depot.lat, depot.lng], 12);

        // Limpiar marcadores anteriores
        markers.forEach((marker) => map.removeLayer(marker));
        markers = [];

        // Agregar marcador del depósito
        const depotMarker = L.marker([depot.lat, depot.lng], {
          icon: redDepotIcon,
        })
          .addTo(map)
          .bindPopup("Centro de Distribución");
        markers.push(depotMarker);

        // Agregar marcadores de destinos
        destinations.forEach((dest) => {
          const marker = L.marker([dest.lat, dest.lng])
            .addTo(map)
            .bindPopup(`Cliente ${dest.id}<br>Demanda: ${dest.demand}`);
          markers.push(marker);
        });

        // Ajustar vista para mostrar todos los puntos
        if (destinations.length > 0) {
          const group = new L.featureGroup(markers);
          map.fitBounds(group.getBounds().pad(0.1));
        }
      }

      // Calcular demanda total
      const totalDemand = destinations.reduce((sum, d) => sum + d.demand, 0);
      const totalCapacity = numVehicles * vehicleCapacity;

      let message =
        `Datos cargados exitosamente!\n\n` +
        `Depósito: [${depot.lat.toFixed(5)}, ${depot.lng.toFixed(5)}]\n` +
        `Vehículos: ${numVehicles}\n` +
        `Capacidad por vehículo: ${vehicleCapacity}\n` +
        `Clientes: ${destinations.length}\n` +
        `Demanda total: ${totalDemand} unidades\n` +
        `Capacidad total: ${totalCapacity} unidades\n\n`;

      if (totalDemand > totalCapacity) {
        message +=
          `ADVERTENCIA: La demanda total (${totalDemand}) excede la capacidad total (${totalCapacity}).\n` +
          `Algunos clientes no podrán ser atendidos.\n\n`;
      }

      alert(message);
    } catch (error) {
      alert(
        `Error al cargar el archivo JSON: ${error.message}\n\n` +
          `Asegúrese de que el archivo tenga el formato correcto`
      );
    }
  };
  reader.readAsText(file);

  // Limpiar el input para permitir cargar el mismo archivo nuevamente
  event.target.value = "";
}

// Calcular matriz de distancias y tiempos
async function calculateDistanceMatrix() {
  const locations = [depot, ...destinations].map((d) => [d.lng, d.lat]);

  try {
    const response = await fetch(
      "https://api.openrouteservice.org/v2/matrix/driving-car",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify({
          locations: locations,
          metrics: ["distance", "duration"],
          units: "km",
        }),
      }
    );

    const data = await response.json();
    distanceMatrix = data.distances;
    timeMatrix = data.durations;
    return true;
  } catch (error) {
    console.error("Error calculando matriz de distancias:", error);
    return false;
  }
}

// ¿Utilizar? matriz euclidiana y distancia haversine

// ============================================
// HEURÍSTICA 1: VECINO MÁS CERCANO (NEAREST NEIGHBOR)
//
// DESCRIPCIÓN:
// Algoritmo constructivo que en cada paso selecciona el cliente no visitado
// más cercano al cliente actual, respetando las restricciones de capacidad.
//
// PSEUDOCÓDIGO:
// 1. Para cada vehículo k:
//    2. Iniciar ruta en el depósito
//    3. Mientras haya clientes no visitados y capacidad disponible:
//       4. Seleccionar el cliente no visitado más cercano que quepa
//       5. Agregar a la ruta y actualizar carga
//    6. Retornar al depósito
//
// COMPLEJIDAD: O(n²) donde n es el número de clientes
// REFERENCIA: Clásico en literatura de VRP, ampliamente utilizado
// ============================================
function nearestNeighborVRP() {
  const vehicleRoutes = [];
  const unvisited = [...destinations];

  for (let v = 0; v < numVehicles && unvisited.length > 0; v++) {
    const route = [0]; // Empezar en el depósito (índice 0)
    let currentPos = 0;
    let currentLoad = 0;

    while (unvisited.length > 0) {
      let nearestIdx = -1;
      let nearestDist = Infinity;

      // Encontrar el destino no visitado más cercano que quepa en el vehículo
      for (let i = 0; i < unvisited.length; i++) {
        const destIdx = destinations.indexOf(unvisited[i]) + 1; // +1 porque 0 es el depósito
        const dist = distanceMatrix[currentPos][destIdx];

        if (
          dist < nearestDist &&
          currentLoad + unvisited[i].demand <= vehicleCapacity
        ) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      if (nearestIdx === -1) break; // No hay más destinos que entren

      const nextDest = unvisited.splice(nearestIdx, 1)[0];
      const nextIdx = destinations.indexOf(nextDest) + 1;
      route.push(nextIdx);
      currentPos = nextIdx;
      currentLoad += nextDest.demand;
    }

    route.push(0); // Volver al depósito
    if (route.length > 2) {
      // Solo agregar rutas con al menos un destino
      vehicleRoutes.push(route);
    }
  }

  // Asignar destinos restantes a vehículos adicionales si es necesario
  while (unvisited.length > 0 && vehicleRoutes.length < numVehicles) {
    const route = [0];
    let currentPos = 0;
    let currentLoad = 0;

    while (unvisited.length > 0) {
      let nearestIdx = -1;
      let nearestDist = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const destIdx = destinations.indexOf(unvisited[i]) + 1;
        const dist = distanceMatrix[currentPos][destIdx];

        if (
          dist < nearestDist &&
          currentLoad + unvisited[i].demand <= vehicleCapacity
        ) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      if (nearestIdx === -1) break;

      const nextDest = unvisited.splice(nearestIdx, 1)[0];
      const nextIdx = destinations.indexOf(nextDest) + 1;
      route.push(nextIdx);
      currentPos = nextIdx;
      currentLoad += nextDest.demand;
    }

    route.push(0);
    if (route.length > 2) {
      vehicleRoutes.push(route);
    }
  }

  return vehicleRoutes;
}

// ============================================
// HEURÍSTICA 2: ALGORITMO DE AHORROS (CLARKE-WRIGHT)
//
// DESCRIPCIÓN:
// Algoritmo basado en el concepto de "ahorro" al combinar dos rutas.
// El ahorro de combinar clientes i y j se calcula como:
// s_ij = d(0,i) + d(0,j) - d(i,j)
// donde d(0,i) es la distancia del depósito al cliente i.
//
// PSEUDOCÓDIGO:
// 1. Calcular matriz de ahorros s_ij para todos los pares (i,j)
// 2. Ordenar ahorros de mayor a menor
// 3. Inicializar: cada cliente es una ruta [0, i, 0]
// 4. Para cada ahorro s_ij en orden descendente:
//    5. Si las rutas que terminan en i y empiezan en j pueden combinarse:
//       6. Si la carga combinada ≤ capacidad:
//          7. Combinar las rutas
//
// COMPLEJIDAD: O(n² log n) por el ordenamiento
// REFERENCIA: Clarke & Wright (1964) - "Scheduling of Vehicles from a Central
//            Depot to a Number of Delivery Points"
// ============================================
function savingsAlgorithmVRP() {
  // Calcular ahorros sij = d(0,i) + d(0,j) - d(i,j)
  const savings = [];
  for (let i = 1; i <= destinations.length; i++) {
    for (let j = i + 1; j <= destinations.length; j++) {
      const saving =
        distanceMatrix[0][i] + distanceMatrix[0][j] - distanceMatrix[i][j];
      savings.push({
        i: i,
        j: j,
        saving: saving,
      });
    }
  }

  // Ordenar ahorros de mayor a menor
  savings.sort((a, b) => b.saving - a.saving);

  // Inicializar rutas: cada destino es una ruta [0, i, 0]
  const routes = destinations.map((_, idx) => ({
    route: [0, idx + 1, 0],
    load: destinations[idx].demand,
    ends: { start: idx + 1, end: idx + 1 },
  }));

  // Combinar rutas basándose en ahorros
  for (const saving of savings) {
    if (routes.length <= numVehicles) break;

    const i = saving.i;
    const j = saving.j;

    // Encontrar rutas que terminan en i o empiezan en j
    let routeI = routes.find((r) => r.ends.end === i);
    let routeJ = routes.find((r) => r.ends.start === j);

    if (routeI && routeJ && routeI !== routeJ) {
      const totalLoad = routeI.load + routeJ.load;
      if (totalLoad <= vehicleCapacity) {
        // Combinar rutas: [0, ..., i] + [j, ..., 0] -> [0, ..., i, j, ..., 0]
        const newRoute = routeI.route
          .slice(0, -1)
          .concat(routeJ.route.slice(1));
        const newLoad = totalLoad;
        const newEnds = { start: routeI.ends.start, end: routeJ.ends.end };

        // Eliminar rutas antiguas
        const idxI = routes.indexOf(routeI);
        const idxJ = routes.indexOf(routeJ);
        routes.splice(Math.max(idxI, idxJ), 1);
        routes.splice(Math.min(idxI, idxJ), 1);

        // Agregar ruta combinada
        routes.push({ route: newRoute, load: newLoad, ends: newEnds });
      }
    }
  }

  return routes.map((r) => r.route);
}

// ============================================
// HEURÍSTICA 3: MEJORA 2-OPT
//
// DESCRIPCIÓN:
// Algoritmo de mejora local que busca mejorar una ruta existente invirtiendo
// segmentos de la ruta. En cada iteración, prueba todas las inversiones
// posibles de 2 arcos y mantiene la que reduce más la distancia.
//
// PSEUDOCÓDIGO:
// 1. Mejorar = true
// 2. Mientras mejorar:
//    3. Mejorar = false
//    4. Para cada par (i, j) de posiciones en la ruta:
//       5. Crear nueva ruta invirtiendo segmento entre i y j
//       6. Si nueva distancia < mejor distancia:
//          7. Actualizar mejor ruta
//          8. Mejorar = true
//
// COMPLEJIDAD: O(n²) por iteración
// REFERENCIA: Croes (1958) - "A Method for Solving Traveling-Salesman Problems"
// NOTA: Puede aplicarse a cualquier solución inicial
// ============================================
function twoOptImprovement(route) {
  let improved = true;
  let bestRoute = [...route];
  let bestDistance = calculateRouteDistance(route);

  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 2; i++) {
      for (let j = i + 1; j < route.length - 1; j++) {
        // Crear nueva ruta invirtiendo el segmento entre i y j
        const newRoute = [
          ...route.slice(0, i),
          ...route.slice(i, j + 1).reverse(),
          ...route.slice(j + 1),
        ];
        const newDistance = calculateRouteDistance(newRoute);

        if (newDistance < bestDistance) {
          bestRoute = newRoute;
          bestDistance = newDistance;
          improved = true;
        }
      }
    }
    route = bestRoute;
  }

  return bestRoute;
}

// Calcular distancia total de una ruta
function calculateRouteDistance(route) {
  let distance = 0;
  for (let i = 0; i < route.length - 1; i++) {
    distance += distanceMatrix[route[i]][route[i + 1]];
  }
  return distance;
}

// Calcular tiempo total de una ruta
function calculateRouteTime(route) {
  let time = 0;
  for (let i = 0; i < route.length - 1; i++) {
    time += timeMatrix[route[i]][route[i + 1]];
  }
  return time;
}

// Calcular consumo de combustible en ruta
function calculateRouteEnergy(route) {
  const distance = calculateRouteDistance(route);
  return (distance / 100) * fuelConsumption; // Litros
}

// ============================================
// FUNCIÓN PRINCIPAL: RESOLVER VRP
// ============================================
async function solveVRP() {
  clearMap();

  // Validar el problema antes de resolver
  if (!validateProblem()) {
    return;
  }

  const useNN = document.getElementById("useNearestNeighbor").checked;
  const useSavings = document.getElementById("useSavings").checked;
  const use2Opt = document.getElementById("use2Opt").checked;

  if (!useNN && !useSavings) {
    alert("Seleccione al menos un algoritmo heurístico");
    return;
  }

  // Mostrar depósito
  const depotMarker = L.marker([depot.lat, depot.lng], { icon: redDepotIcon })
    .addTo(map)
    .bindPopup("Centro de Distribución");
  markers.push(depotMarker);

  // Mostrar destinos
  destinations.forEach((dest) => {
    const marker = L.marker([dest.lat, dest.lng])
      .addTo(map)
      .bindPopup(`Destino ${dest.id}<br>Demanda: ${dest.demand}`);
    markers.push(marker);
  });

  // Calcular matriz de distancias
  await calculateDistanceMatrix();

  const results = [];
  let colorIndex = 0;

  // Ejecutar heurísticas seleccionadas
  if (useNN) {
    let routes = nearestNeighborVRP();
    if (use2Opt) {
      routes = routes.map((route) => twoOptImprovement(route));
    }
    const result = evaluateSolution(
      routes,
      "Vecino Más Cercano" + (use2Opt ? " + 2-Opt" : ""),
      colorIndex
    );
    colorIndex++;
    results.push(result);
    visualizeRoutes(routes, result.color, result.algorithm);
  }

  if (useSavings) {
    let routes = savingsAlgorithmVRP();
    if (use2Opt) {
      routes = routes.map((route) => twoOptImprovement(route));
    }
    const result = evaluateSolution(
      routes,
      "Algoritmo de Ahorros" + (use2Opt ? " + 2-Opt" : ""),
      colorIndex
    );
    colorIndex++;
    results.push(result);
    visualizeRoutes(routes, result.color, result.algorithm);
  }

  // Mostrar resultados en nueva pestaña
  displayResultsInNewTab(results);
}

// Evaluar solución
function evaluateSolution(routes, algorithmName, colorIndex) {
  let totalDistance = 0;
  let totalTime = 0;
  let totalEnergy = 0;
  let totalVehicles = routes.length;

  routes.forEach((route) => {
    totalDistance += calculateRouteDistance(route);
    totalTime += calculateRouteTime(route);
    totalEnergy += calculateRouteEnergy(route);
  });

  return {
    algorithm: algorithmName,
    distance: totalDistance,
    time: totalTime,
    energy: totalEnergy,
    vehicles: totalVehicles,
    routes: routes,
    color: vehicleColors[colorIndex % vehicleColors.length],
  };
}

// Visualizar rutas en el mapa
async function visualizeRoutes(routesParam, color, algorithmName) {
  for (let v = 0; v < routesParam.length; v++) {
    const route = routesParam[v];
    const routeColor = vehicleColors[v % vehicleColors.length];

    // Construir coordenadas para la petición: [lng, lat]
    const coords = route.map((idx) => {
      const p = idx === 0 ? depot : destinations[idx - 1];
      return [p.lng, p.lat];
    });

    // Contenido del popup (resumen)
    const popupContent = `
      <div style="text-align: center;">
        <strong style="color: ${routeColor}; font-size: 14px;">${algorithmName}</strong><br>
        <strong>Vehículo ${v + 1}</strong><br>
        <hr style="margin: 5px 0;">
        <span style="font-size: 12px;">Ruta: ${route
          .map((i) => (i === 0 ? "D" : i))
          .join(" → ")}</span>
      </div>
    `;

    try {
      const body = {
        coordinates: coords,
        format: "geojson",
        instructions: false,
      };

      const res = await fetchWithRetry(
        "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: apiKey,
          },
          body: JSON.stringify(body),
        },
        5
      );

      const data = await res.json();
      const layer = L.geoJSON(data, {
        style: {
          color: routeColor,
          weight: 4,
          opacity: 0.7,
        },
      }).addTo(map);

      layer.bindPopup(popupContent);
      layer.on("mouseover", function (e) {
        this.setStyle({ weight: 6, opacity: 1 });
      });
      layer.on("mouseout", function (e) {
        this.setStyle({ weight: 4, opacity: 0.7 });
      });

      // Guardar en array global de capas
      globalThis.routes.push(layer);
    } catch (error) {
      // Fallback: línea poligonal simple entre puntos (lat, lng)
      const latlngs = route.map((idx) => {
        const p = idx === 0 ? depot : destinations[idx - 1];
        return [p.lat, p.lng];
      });

      const line = L.polyline(latlngs, {
        color: routeColor,
        weight: 4,
        opacity: 0.7,
      }).addTo(map);

      line.bindPopup(popupContent);
      line.on("mouseover", function (e) {
        this.setStyle({ weight: 6, opacity: 1 });
      });
      line.on("mouseout", function (e) {
        this.setStyle({ weight: 4, opacity: 0.7 });
      });

      globalThis.routes.push(line);
    }
  }
}

// Dibujar ruta entre dos puntos
async function drawRoute(
  from,
  to,
  color,
  vehicleNum,
  algorithmName,
  fullRoute
) {
  // Encontrar nombres de origen y destino
  let fromName = "Depósito";
  let toName = "Depósito";

  // Buscar si el punto de origen es un cliente (comparación con tolerancia)
  const tolerance = 0.0001;
  const fromClient = destinations.find(
    (d) =>
      Math.abs(d.lat - from[0]) < tolerance &&
      Math.abs(d.lng - from[1]) < tolerance
  );
  if (fromClient) {
    fromName = `Cliente ${fromClient.id}`;
  }

  // Buscar si el punto de destino es un cliente
  const toClient = destinations.find(
    (d) =>
      Math.abs(d.lat - to[0]) < tolerance && Math.abs(d.lng - to[1]) < tolerance
  );
  if (toClient) {
    toName = `Cliente ${toClient.id}`;
  }

  const popupContent = `
    <div style="text-align: center;">
      <strong style="color: ${color}; font-size: 14px;">${algorithmName}</strong><br>
      <strong>Vehículo ${vehicleNum}</strong><br>
      <hr style="margin: 5px 0;">
      <span style="font-size: 12px;">${fromName} → ${toName}</span>
    </div>
  `;

  try {
    const response = await fetch(
      "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify({
          coordinates: [
            [from[1], from[0]],
            [to[1], to[0]],
          ],
          format: "geojson",
        }),
      }
    );

    const data = await response.json();
    const layer = L.geoJSON(data, {
      style: {
        color: color,
        weight: 4,
        opacity: 0.7,
      },
    }).addTo(map);

    // Agregar popup y eventos de mouse
    layer.bindPopup(popupContent);
    layer.on("mouseover", function (e) {
      this.setStyle({ weight: 6, opacity: 1 });
    });
    layer.on("mouseout", function (e) {
      this.setStyle({ weight: 4, opacity: 0.7 });
    });

    routes.push(layer);
  } catch (error) {
    // Fallback: línea recta
    const line = L.polyline([from, to], {
      color: color,
      weight: 4,
      opacity: 0.7,
    }).addTo(map);

    // Agregar popup y eventos de mouse
    line.bindPopup(popupContent);
    line.on("mouseover", function (e) {
      this.setStyle({ weight: 6, opacity: 1 });
    });
    line.on("mouseout", function (e) {
      this.setStyle({ weight: 4, opacity: 0.7 });
    });

    routes.push(line);
  }
}

// Mostrar resultados
function displayResults(results) {
  const resultsDiv = document.getElementById("results");
  const contentDiv = document.getElementById("resultsContent");
  resultsDiv.style.display = "block";

  // Encontrar mejor resultado
  const bestResult = results.reduce((best, current) =>
    current.distance < best.distance ? current : best
  );

  let html = '<table class="comparison-table">';
  html +=
    "<tr><th>Algoritmo</th><th>Distancia (km)</th><th>Tiempo (h)</th><th>Combustible (L)</th><th>Vehículos</th></tr>";

  results.forEach((result) => {
    const isBest = result === bestResult;
    const rowClass = isBest ? "best-result" : "";
    html += `<tr class="${rowClass}">`;
    html += `<td>${result.algorithm}</td>`;
    html += `<td>${result.distance.toFixed(2)}</td>`;
    html += `<td>${(result.time / 3600).toFixed(2)}</td>`;
    html += `<td>${result.energy.toFixed(2)}</td>`;
    html += `<td>${result.vehicles}</td>`;
    html += "</tr>";
  });

  html += "</table>";

  // Detalles adicionales
  html += '<div style="margin-top: 20px;">';
  html += `<h3>Mejor Solución: ${bestResult.algorithm}</h3>`;
  html += `<div class="result-item">`;
  html += `<div class="metric"><span>Distancia Total:</span><span class="metric-value">${bestResult.distance.toFixed(
    2
  )} km</span></div>`;
  html += `<div class="metric"><span>Tiempo Total:</span><span class="metric-value">${(
    bestResult.time / 3600
  ).toFixed(2)} horas</span></div>`;
  html += `<div class="metric"><span>Consumo de Combustible:</span><span class="metric-value">${bestResult.energy.toFixed(
    2
  )} litros</span></div>`;
  html += `<div class="metric"><span>Número de Vehículos:</span><span class="metric-value">${bestResult.vehicles}</span></div>`;
  html += `</div>`;

  // Detalles de rutas
  html += "<h3>Detalles de Rutas:</h3>";
  bestResult.routes.forEach((route, idx) => {
    const routeDist = calculateRouteDistance(route);
    const routeTime = calculateRouteTime(route);
    const routeEnergy = calculateRouteEnergy(route);
    html += `<div class="result-item">`;
    html += `<h3>Vehículo ${idx + 1}</h3>`;
    html += `<div class="metric"><span>Ruta:</span><span class="metric-value">${route
      .map((i) => (i === 0 ? "D" : i))
      .join(" → ")}</span></div>`;
    html += `<div class="metric"><span>Distancia:</span><span class="metric-value">${routeDist.toFixed(
      2
    )} km</span></div>`;
    html += `<div class="metric"><span>Tiempo:</span><span class="metric-value">${(
      routeTime / 3600
    ).toFixed(2)} h</span></div>`;
    html += `<div class="metric"><span>Combustible:</span><span class="metric-value">${routeEnergy.toFixed(
      2
    )} L</span></div>`;
    html += `</div>`;
  });

  html += "</div>";

  // Agregar botón de exportación
  html +=
    '<button class="success" onclick="exportCurrentResults()" style="margin-top: 15px; width: 100%;">Exportar Resultados (JSON)</button>';

  contentDiv.innerHTML = html;

  // Guardar resultados globalmente para exportación
  window.currentResults = results;
}

// Función para exportar resultados actuales
function exportCurrentResults() {
  if (window.currentResults) {
    exportResults(window.currentResults);
  } else {
    alert("No hay resultados para exportar. Resuelva el problema primero.");
  }
}

// Mostrar resultados en nueva pestaña
function displayResultsInNewTab(results) {
  // Encontrar mejor resultado
  const bestResult = results.reduce((best, current) =>
    current.distance < best.distance ? current : best
  );

  let html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Resultados VRP - Optimización de Ruteo Vehicular</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: #f5f5f5;
          padding: 20px;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
          color: #2c3e50;
          margin-bottom: 30px;
          border-bottom: 3px solid #3498db;
          padding-bottom: 10px;
        }
        h2 {
          color: #34495e;
          margin: 25px 0 15px 0;
          font-size: 20px;
        }
        h3 {
          color: #2c3e50;
          margin: 20px 0 10px 0;
          font-size: 18px;
        }
        .comparison-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .comparison-table th,
        .comparison-table td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }
        .comparison-table th {
          background: #3498db;
          color: white;
          font-weight: 600;
        }
        .comparison-table tr:hover {
          background: #f5f5f5;
        }
        .best-result {
          background: #d5f4e6 !important;
          font-weight: 600;
        }
        .result-item {
          padding: 15px;
          margin: 10px 0;
          background: #f9f9f9;
          border-radius: 4px;
          border-left: 4px solid #3498db;
        }
        .metric {
          display: flex;
          justify-content: space-between;
          margin: 8px 0;
          color: #555;
        }
        .metric-value {
          font-weight: 600;
          color: #2c3e50;
        }
        .route-detail {
          background: white;
          padding: 15px;
          margin: 10px 0;
          border-radius: 4px;
          border: 1px solid #ddd;
        }
        .export-btn {
          background: #27ae60;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          margin-top: 20px;
        }
        .export-btn:hover {
          background: #229954;
        }
        .timestamp {
          color: #7f8c8d;
          font-size: 12px;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Resultados de Optimización de Ruteo Vehicular (VRP)</h1>
        <div class="timestamp">Generado el: ${new Date().toLocaleString(
          "es-ES"
        )}</div>
        
        <h2>Comparación de Algoritmos</h2>
        <table class="comparison-table">
          <tr>
            <th>Algoritmo</th>
            <th>Distancia (km)</th>
            <th>Tiempo (h)</th>
            <th>Combustible (L)</th>
            <th>Vehículos</th>
          </tr>
  `;

  results.forEach((result) => {
    const isBest = result === bestResult;
    const rowClass = isBest ? "best-result" : "";
    html += `<tr class="${rowClass}">`;
    html += `<td>${result.algorithm}</td>`;
    html += `<td>${result.distance.toFixed(2)}</td>`;
    html += `<td>${(result.time / 3600).toFixed(2)}</td>`;
    html += `<td>${result.energy.toFixed(2)}</td>`;
    html += `<td>${result.vehicles}</td>`;
    html += "</tr>";
  });

  html += `
        </table>

        <h2>Mejor Solución: ${bestResult.algorithm}</h2>
        <div class="result-item">
          <div class="metric">
            <span>Distancia Total:</span>
            <span class="metric-value">${bestResult.distance.toFixed(
              2
            )} km</span>
          </div>
          <div class="metric">
            <span>Tiempo Total:</span>
            <span class="metric-value">${(bestResult.time / 3600).toFixed(
              2
            )} horas</span>
          </div>
          <div class="metric">
            <span>Consumo de Combustible:</span>
            <span class="metric-value">${bestResult.energy.toFixed(
              2
            )} litros</span>
          </div>
          <div class="metric">
            <span>Número de Vehículos:</span>
            <span class="metric-value">${bestResult.vehicles}</span>
          </div>
        </div>

        <h2>Detalles de Rutas por Vehículo</h2>
  `;

  bestResult.routes.forEach((route, idx) => {
    const routeDist = calculateRouteDistance(route);
    const routeTime = calculateRouteTime(route);
    const routeEnergy = calculateRouteEnergy(route);
    const routeColor = vehicleColors[idx % vehicleColors.length];

    html += `<div class="route-detail">`;
    html += `<h3>Vehículo ${
      idx + 1
    } <span style="display: inline-block; width: 20px; height: 4px; background-color: ${routeColor}; margin-left: 10px; vertical-align: middle;"></span></h3>`;
    html += `<div class="metric"><span>Ruta:</span><span class="metric-value">${route
      .map((i) => (i === 0 ? "D" : i))
      .join(" → ")}</span></div>`;
    html += `<div class="metric"><span>Distancia:</span><span class="metric-value">${routeDist.toFixed(
      2
    )} km</span></div>`;
    html += `<div class="metric"><span>Tiempo:</span><span class="metric-value">${(
      routeTime / 3600
    ).toFixed(2)} h</span></div>`;
    html += `<div class="metric"><span>Combustible:</span><span class="metric-value">${routeEnergy.toFixed(
      2
    )} L</span></div>`;
    html += `</div>`;
  });

  html += `
        <button class="export-btn" onclick="exportResults()">Exportar Resultados (JSON)</button>
      </div>
      <script>
        function exportResults() {
          const data = ${JSON.stringify(results, null, 2)};
          const dataStr = JSON.stringify(data, null, 2);
          const dataBlob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(dataBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'vrp_results_${Date.now()}.json';
          link.click();
          URL.revokeObjectURL(url);
        }
      </script>
    </body>
    </html>
  `;

  // Abrir nueva pestaña con los resultados
  const newWindow = window.open("", "_blank");
  newWindow.document.write(html);
  newWindow.document.close();

  // También mantener los resultados en el sidebar (opcional)
  const resultsDiv = document.getElementById("results");
  const contentDiv = document.getElementById("resultsContent");
  resultsDiv.style.display = "block";
  contentDiv.innerHTML =
    '<p style="color: #27ae60; font-weight: 600;">✓ Resultados abiertos en nueva pestaña</p>';

  // Guardar resultados globalmente para exportación
  window.currentResults = results;
}

// Limpiar mapa
function clearMap() {
  markers.forEach((marker) => map.removeLayer(marker));
  routes.forEach((route) => map.removeLayer(route));
  markers = [];
  routes = [];
  document.getElementById("results").style.display = "none";
}

// Validar que todas las demandas puedan ser satisfechas
function validateProblem() {
  const totalDemand = destinations.reduce((sum, d) => sum + d.demand, 0);
  const totalCapacity = numVehicles * vehicleCapacity;

  if (totalDemand > totalCapacity) {
    alert(
      `ADVERTENCIA: La demanda total (${totalDemand}) excede la capacidad total (${totalCapacity}). ` +
        `Algunos clientes no podrán ser atendidos.`
    );
    return false;
  }

  if (destinations.length === 0) {
    alert(
      "Error: No hay destinos definidos. Por favor, cargue un archivo JSON primero."
    );
    return false;
  }

  if (!depot) {
    alert(
      "Error: No hay depósito definido. Por favor, cargue un archivo JSON primero."
    );
    return false;
  }

  return true;
}

// Exportar resultados a JSON
function exportResults(results) {
  const exportData = {
    timestamp: new Date().toISOString(),
    problem: {
      numVehicles: numVehicles,
      capacity: vehicleCapacity,
      numDestinations: destinations.length,
      totalDemand: destinations.reduce((sum, d) => sum + d.demand, 0),
      depot: depot,
      destinations: destinations,
    },
    results: results.map((r) => ({
      algorithm: r.algorithm,
      distance: r.distance,
      time: r.time,
      energy: r.energy,
      vehicles: r.vehicles,
      routes: r.routes,
    })),
    bestSolution: results.reduce((best, current) =>
      current.distance < best.distance ? current : best
    ),
  };

  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vrp_results_${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Inicializar cuando se carga la página
window.addEventListener("DOMContentLoaded", initMap);
