//------------------ DOM Elements ------------------//
const modal = document.getElementById('welcomeModal');
const closeBtn = document.getElementById('closeModal');
const fileInput = document.getElementById('fileInput');
const sportFilter = document.getElementById('sportFilter');
const refreshBtn = document.getElementById('refreshFilters');
const kpiDistance = document.getElementById("kpi-distance");
const kpiElev = document.getElementById("kpi-elev");
const kpiPace = document.getElementById("kpi-pace");
const kpiSpeed = document.getElementById("kpi-speed");
const kpiCount = document.getElementById("kpi-count");
const kpiConsistency = document.getElementById("kpi-consistency");
const kpiVolumeTrend = document.getElementById("kpi-volume-trend");

//------------------ Global State ------------------//

const STATE = {
  viewStart: null,
  viewEnd: null
};

// Data Storage
const activityData = {};   // sport_type → array of latlngs
const activityMeta = {};   // sport_type → array of {date, elevation, distance, moving_time, country, name} 
let chart;


//---------------- Map Initialization ---------------//
const map = L.map('map').setView([0, 0], 2);



//---------------- Layers + Legend ------------------//

// Base Map
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);

// Heatmap Layer
const heatLayer = L.heatLayer([], {
  radius: 8, blur: 7, maxZoom: 17, minOpacity: 0.4,
  gradient: { 0: 'blue', 0.25: 'cyan', 0.5: 'lime', 0.75: 'yellow', 1: 'red' },
  max: 1
});

// Polyline Layer
const polylineLayer = L.layerGroup().addTo(map);

// Layer Control
const layerControl = L.control.layers({}, { "Routes": polylineLayer, "Density Heatmap": heatLayer }).addTo(map);

//Legend
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'leaflet-control-legend');
    div.innerHTML = `
        <p><b>Activity Density</b></p>
        <span class="gradient"></span>
        <div class="labels"><span>Low</span><span>High</span></div>
    `;
    return div;
};

// Legend Toggle Behavior
map.on('overlayadd', function(e) {
    if (e.layer === heatLayer) {legend.addTo(map);}
});

map.on('overlayremove', function(e) {
    if (e.layer === heatLayer) {map.removeControl(legend);}
});


//-------------------- Modal --------------------//

// Close when clicking button
closeBtn.addEventListener('click', () => {
  modal.style.display = 'none';
});

// Close when clicking outside content
modal.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.style.display = 'none';
  }
});



//------------------ Utilities ------------------//
const m2km = m => m / 1000;
const secToPace = sec => {
  if(!isFinite(sec) || sec<=0) return "--:--";
  const m = Math.floor(sec/60), s = Math.round(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
};

// Helper function to convert seconds to HH:MM:SS format
const secToHMS = (sec) => {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.round(sec % 60);
    return [
        hours > 0 ? hours.toString().padStart(2, '0') : null,
        minutes.toString().padStart(2, '0'),
        seconds.toString().padStart(2, '0')
    ].filter(Boolean).join(':');
};

// Polyline Decoder 
function decodePolyline(str, precision = 5) {
  let index = 0, lat = 0, lng = 0, coordinates = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

function checkScroll() {
    const footer = document.getElementById("footerBanner");
    const banner = document.getElementById("topBanner");
    const body = document.body;

    if (document.documentElement.scrollHeight > window.innerHeight) {
        footer.classList.add("fixed-footer");
        banner.classList.add("fixed-banner");
        body.classList.add("footer-active");
        body.classList.add("banner-active");
    } else {
        footer.classList.remove("fixed-footer");
        banner.classList.remove("fixed-banner");
        body.classList.remove("footer-active");
        body.classList.remove("banner-active");
    }
}

window.addEventListener("load", checkScroll);
window.addEventListener("resize", checkScroll);

//------------------ Filters ------------------//

// Filter by sport
function getFilteredActivities(selectedSport, bounds, filterByDate) {
    let acts = [];
    const sportsToUse = selectedSport === "all" ? Object.keys(activityMeta) : [selectedSport];

    sportsToUse.forEach(sport => {
        (activityMeta[sport] || []).forEach((act, idx) => {
            if (!act || !filterByDate(act)) return; 
            
            const activityCoords = activityData[sport] ? activityData[sport][idx] : null;

            // Bounds check - only include activity if it has coords and intersects bounds
            if (bounds) {
                if (!activityCoords) return; 
                
                const poly = L.polyline(activityCoords);
                if (!poly.getBounds().intersects(bounds)) return;
            }
            
            // If it passes all filters, push it
            acts.push({
                meta: act,
                coords: activityCoords,
                sport: sport,
                index: idx
            });
        });
    });
    return acts;
}

// Filter by date range
function filterByDate(act) {
    if (STATE.viewStart && act.date < STATE.viewStart) return false;
    if (STATE.viewEnd && act.date > STATE.viewEnd) return false;
    return true;
}

//---------------- Render Functions ----------------//

// Map Update with bounds Function
function updateMap(selectedSport, filterByDate = ()=>true) {
  polylineLayer.clearLayers();
  let allCoords = [];
  const filteredActivities = getFilteredActivities(selectedSport, null, filterByDate); // Get all visible routes
  
  const currentRoutes = [];

  filteredActivities.forEach(activity => {
      const meta = activity.meta;
      const latlngs = activity.coords;

      if (!latlngs) return; // Skip if no coordinates

      const poly = L.polyline(latlngs, { color: 'blue', weight: 2, opacity: 0.6 }).addTo(polylineLayer);
      currentRoutes.push(poly);
      allCoords.push(...latlngs);

      poly.on('mouseover', function(e) {
        L.popup({ offset: L.point(0, -10), closeButton: false, autoClose: false, className: 'route-popup' })
          .setLatLng(e.latlng)
          .setContent(`
            <b>Sport:</b> ${activity.sport}<br>
            <b>Date:</b> ${meta.date.toLocaleDateString()}<br>
            <b>Distance:</b> ${(meta.distance/1000).toFixed(2)} km<br>
            <b>Elevation:</b> ${meta.elevation.toFixed(0)} m<br>
            <b>Moving time:</b> ${(meta.moving_time/3600).toFixed(2)} h<br>
            <b>Name:</b> ${meta.name || 'N/A'}
          `)
          .openOn(map);
      });
      poly.on('mouseout', () => map.closePopup());
    });
    
    // Fit Bounds to the new filtered routes
    if (currentRoutes.length > 0) {
      const featureGroup = L.featureGroup(currentRoutes);
      // Check if bounds are valid 
      const bounds = featureGroup.getBounds();
      if (bounds && bounds.isValid && bounds.isValid()) map.fitBounds(bounds, { padding: [20,20] }); // <<< FIXED
      }
      // Heatmap generation logic 
      if (allCoords.length > 0) {
      const pointMap = {};
      allCoords.forEach(([lat, lng]) => {
        const key = lat.toFixed(5) + ',' + lng.toFixed(5);
        pointMap[key] = (pointMap[key] || 0) + 1;
      });
      const maxCount = Math.max(...Object.values(pointMap));
      const heatPoints = Object.entries(pointMap).map(([key, count]) => {
        const [lat, lng] = key.split(',').map(Number);
        const intensity = 0.3 + 0.7 * (Math.log(count + 1) / Math.log(maxCount + 1)); 
        return [lat, lng, intensity];
      });
      heatLayer.setLatLngs(heatPoints);
      if (!map.hasLayer(heatLayer)) map.addLayer(heatLayer);
    } else {
      if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
    }
}

// KPIs
function renderKPIs(selectedSport, bounds = null, filterByDate = ()=>true) {
  const acts = getFilteredActivities(selectedSport, bounds, filterByDate).map(a => a.meta);

  const totalDist = acts.reduce((s,a)=>s+(a.distance||0),0);
  const totalTime = acts.reduce((s,a)=>s+(a.moving_time||0),0);
  const totalElevation = acts.reduce((s,a)=>s+(a.elevation||0),0);
  const totalKm = m2km(totalDist);
  const totalHours = totalTime/3600;
  
  const avgSpeed = totalHours > 0 ? (totalKm / totalHours) : 0;
  const avgPace = totalDist > 0 ? (totalTime/totalKm) : NaN;
  
  kpiDistance.textContent = totalKm.toFixed(1);
  kpiElev.textContent = `${totalElevation.toFixed(0)} m`;
  kpiPace.textContent = secToPace(avgPace);
  kpiSpeed.textContent = `${avgSpeed.toFixed(1)} km/h`;
  kpiCount.textContent = acts.length;
  }

// Performance Summary KPIs
function renderStrategicKPIs(selectedSport, bounds = null, filterByDate = ()=>true) {

  const acts = getFilteredActivities(selectedSport, bounds, filterByDate)
                .map(a => a.meta)
                .filter(a => a.date);
  const kpiVolumeTrend = document.getElementById("kpi-volume-trend");

  if (!acts.length) {
    kpiConsistency.textContent = "--";
    kpiVolumeTrend.textContent = "--";
    return;
  }

  const latestDate = new Date(Math.max(...acts.map(a => a.date)));

  // Training Consistency (Last 12 Weeks)

  const WEEKS_TO_ANALYZE = 12;
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

  let activeWeeks = new Set();

  acts.forEach(a => {
    const diff = latestDate - a.date;
    const weekIndex = Math.floor(diff / MS_PER_WEEK);

    if (weekIndex >= 0 && weekIndex < WEEKS_TO_ANALYZE) {
      activeWeeks.add(weekIndex);
    }
  });

  const consistency = (activeWeeks.size / WEEKS_TO_ANALYZE) * 100;

  kpiConsistency.textContent = `${consistency.toFixed(0)}%`;

  kpiConsistency.style.color =
    consistency >= 80 ? "green" :
    consistency >= 50 ? "orange" :
    "red";

  // Volumne Trend (30-day)

  const last30 = new Date(latestDate);
  last30.setDate(last30.getDate() - 30);

  const prev30 = new Date(latestDate);
  prev30.setDate(prev30.getDate() - 60);

  const volumeLast30 = acts
    .filter(a => a.date >= last30)
    .reduce((sum, a) => sum + (a.distance || 0), 0);

  const volumePrev30 = acts
    .filter(a => a.date >= prev30 && a.date < last30)
    .reduce((sum, a) => sum + (a.distance || 0), 0);

  let trend = 0;

  if (volumePrev30 > 0) {
    trend = ((volumeLast30 - volumePrev30) / volumePrev30) * 100;
  }

  kpiVolumeTrend.textContent = `${trend >= 0 ? "+" : ""}${trend.toFixed(1)}%`;

  kpiVolumeTrend.style.color =
    trend > 5 ? "green" :
    trend < -5 ? "red" :
    "orange";
}

// Personal Bests
function renderPersonalBests(selectedSport, bounds = null, filterByDate = ()=>true) {
    const tableBody = document.getElementById('personal-bests-table');
    
    tableBody.innerHTML = `
        <thead>
            <tr>
                <th>PB Type</th>
                <th>Value</th>
                <th>Date</th>
                <th>Activity Name</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;
    const tbody = tableBody.querySelector('tbody');
    
    const acts = getFilteredActivities(selectedSport, bounds, filterByDate).map(a => a.meta);

    if (acts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4">No activities found in the selected area.</td></tr>';
        return;
    }

    // Initialize PBs
    const pbs = {
        longestDistance: { value: 0, date: null, name: null },
        longestDuration: { value: 0, date: null, name: null }
    };

    acts.forEach((act) => {
        const activityName = act.name || (act.date ? act.date.toLocaleDateString() : 'N/A'); 

        if (act.distance > pbs.longestDistance.value) {
            pbs.longestDistance.value = act.distance;
            pbs.longestDistance.date = act.date;
            pbs.longestDistance.name = activityName;
        }

        if (act.moving_time > pbs.longestDuration.value) {
            pbs.longestDuration.value = act.moving_time;
            pbs.longestDuration.date = act.date;
            pbs.longestDuration.name = activityName;
        }
    });

    const distanceRow = `
        <tr>
            <th>Longest Distance</th>
            <td class="distance">${m2km(pbs.longestDistance.value).toFixed(2)} km</td>
            <td>${pbs.longestDistance.date ? pbs.longestDistance.date.toLocaleDateString() : '--'}</td>
            <td>${pbs.longestDistance.name || '--'}</td>
        </tr>
    `;

    const durationRow = `
        <tr>
            <th>Longest Duration</th>
            <td class="time">${secToHMS(pbs.longestDuration.value)}</td>
            <td>${pbs.longestDuration.date ? pbs.longestDuration.date.toLocaleDateString() : '--'}</td>
            <td>${pbs.longestDuration.name || '--'}</td>
        </tr>
    `;

    tbody.innerHTML = distanceRow + durationRow;
}

// Update Chart
function updateChart(selectedSport, bounds = null, filterByDate = ()=>true) {
  const monthlyData = {};
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  
  const acts = getFilteredActivities(selectedSport, bounds, filterByDate).map(a => a.meta);

  acts.forEach(act => {
      const month = act.date.getMonth();
      if (!monthlyData[month]) monthlyData[month] = 0;

      if (selectedSport === "all") monthlyData[month] += 1;
      else if (["Ride","Hike","GravelRide"].includes(selectedSport)) monthlyData[month] += act.elevation;
      else if (["Run","Walk"].includes(selectedSport)) monthlyData[month] += act.distance; 
      else if (["StandUpPaddling","Snowboard"].includes(selectedSport)) monthlyData[month] += act.moving_time; 
  });
  
  const data = months.map((_, idx) => monthlyData[idx] || 0);

  let label;
  if (selectedSport === "all") label = "Activity Frequency (Count)";
  else if (["Ride","Hike","GravelRide"].includes(selectedSport)) label = "Elevation Gained (m)";
  else if (["Run","Walk"].includes(selectedSport)) label = "Distance (km)";
  else if (["StandUpPaddling","Snowboard"].includes(selectedSport)) label = "Moving Time (hours)";
  else label = selectedSport;

  const displayData = data.map(value => {
    if (["Run","Walk"].includes(selectedSport)) return (value / 1000).toFixed(1);
    if (["StandUpPaddling","Snowboard"].includes(selectedSport)) return (value / 3600).toFixed(1);
    return value.toFixed(1); 
  });

  if (!chart) {
    const ctx = document.getElementById('activityChart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: months, datasets: [{ label, data: displayData, backgroundColor: '#ff9161', borderColor: '#FC4C02', borderWidth: 2 }] },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  } else {
    chart.data.datasets[0].label = label;
    chart.data.datasets[0].data = displayData;
    chart.update();
  }
}

const uploadBtn = document.getElementById('uploadDataBtn');

// Trigger file selection dialog
uploadBtn.addEventListener('click', () => {
  fileInput.click();
});

// Handle user-uploaded file
fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  // Process user's CSV
  Papa.parse(file, {
    header: true,
    complete: (results) => {
      processData(results); // overwrite data arrays with user's data
      modal.style.display = 'none'; // close modal
    }
  });
});


// Render All (central refresh)
function renderAll() {
  const sport = sportFilter.value;

  updateMap(sport, filterByDate);                    // 1. Map Update: Includes the logic for fitBounds based on new filters

  const bounds = map.getBounds();                    //AFTER UPDATE MAP
  
  renderStrategicKPIs(sport, bounds, filterByDate);  // 2. Performance Summary Update
  renderKPIs(sport, bounds, filterByDate);           // 3. KPI Update
  updateChart(sport, bounds, filterByDate);          // 4. Chart Update
  renderPersonalBests(sport, bounds, filterByDate);  // 5. PBs Update 
}

//------------------ Data Processing Logic ------------------//
function processData(results) {
  // Clear existing data before processing new data
  Object.keys(activityData).forEach(key => delete activityData[key]);
  Object.keys(activityMeta).forEach(key => delete activityMeta[key]);

  // Clear sport filter options (except the "all" option)
  Array.from(sportFilter.options).filter(o => o.value !== 'all').forEach(o => o.remove());


  results.data.forEach(row => {
    if (!row["map.summary_polyline"]) return;

    let sport = row["sport_type"] || "Other";
    sport = sport.replace(/\s+/g, ''); 

    if (!activityData[sport]) activityData[sport] = [];
    if (!activityMeta[sport]) activityMeta[sport] = [];

    try {
      const coords = decodePolyline(row["map.summary_polyline"]);
      const latlngs = coords.map(c => [c[0], c[1]]);
      activityData[sport].push(latlngs);

      const elevation = parseFloat(row["total_elevation_gain"]) || 0;
      const distance = parseFloat(row["distance"]) || 0;
      const moving_time = parseFloat(row["moving_time"]) || 0;
      const date = row["start_date_local"] ? new Date(row["start_date_local"]) : null;
      const country = row["location_country"] || null;
      const name = row["name"] || null; 

      if (date) 
        
        activityMeta[sport].push({ date, elevation, distance, moving_time, country, name }); 
    } catch (e) {
      console.error("Invalid polyline", e);
    }
  });
  
  Object.keys(activityData).forEach(sport => {
    if (!Array.from(sportFilter.options).some(o => o.value === sport)) {
      const option = document.createElement('option');
      option.value = sport;
      option.text = sport;
      sportFilter.appendChild(option);
    }
  });
  
  // Set filter to 'all'
  sportFilter.value = "all";
  
  // Render all components once after data loads
  renderAll(); 

  // Hide the upload control
  document.getElementById('controls').style.display = 'none';
}

// Default Data Loader
function loadDefaultData() {
  const defaultFilePath = 'data/nicole_strava.csv';
  console.log(`Loading default data from: ${defaultFilePath}`);

  fetch(defaultFilePath)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Could not load default file. HTTP status: ${response.status}`);
      }
      return response.text();
    })
    .then(csvText => {
      Papa.parse(csvText, {
        header: true,
        complete: processData 
      });
    })
    .catch(error => {
      console.error("Dashboard failed to load default data:", error);
      document.getElementById('controls').style.display = 'block'; 

    });
}

// File Upload Handler
fileInput.addEventListener('change', function(event) {
  const file = event.target.files[0];
  if (!file) return;

  Papa.parse(file, {
    header: true,
    complete: processData
  });
});


//------------------ Events ------------------//

// Date pickers & quick filters
const fpStart = flatpickr('#startDate',{
  dateFormat:'Y-m-d',
  onChange:([d])=>{
    STATE.viewStart=d; 
    renderAll();
  }
});
const fpEnd   = flatpickr('#endDate',{
  dateFormat:'Y-m-d',
  onChange:([d])=>{
    STATE.viewEnd=d; 
    renderAll();
  }
});

// Reset Filters Button
refreshBtn.addEventListener('click', () => {

  // Clear date filters
  STATE.viewStart = null;
  STATE.viewEnd = null;

  fpStart.clear();
  fpEnd.clear();

  sportFilter.value = "all"; // Reset sport filter
  map.setView([0, 0], 2);  // Reset map view

  renderAll(); // Re-render everything
});

// Update KPIs, Charts, PBs, and Performance Summary when bbox changes
map.on('moveend', () => {
  const bounds = map.getBounds();
  const sport = sportFilter.value;

  // IMPORTANT: DO NOT call updateMap here, it causes a zoom loop.
  updateChart(sport, bounds, filterByDate);
  renderKPIs(sport, bounds, filterByDate);   
  renderPersonalBests(sport, bounds, filterByDate); 
  renderStrategicKPIs(sport, bounds, filterByDate); 
});

// Update Map (zoom/routes), KPIs, Charts, PBs, and Performance Summary when sport filter changes
sportFilter.addEventListener('change', function() {
  renderAll();
});


//------------------ Initialization ------------------//
loadDefaultData();

