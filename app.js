/* =====================================================================
   İstanbul Yeşil Alanlar — Su Ayak İzi & İklim Uyumlu Peyzaj Asistanı
   ArcGIS Maps SDK for JavaScript v4.28
   ===================================================================== */

/* 🔑 ArcGIS API anahtarınızı buraya girin.
   Olmadan: arcgis/topographic altlığı, dünya yükseklik modeli ve Places API
   çalışmaz. Ücretsiz anahtar: https://developers.arcgis.com  */
const ARCGIS_API_KEY = "AAPTa8kJy_3i2t-cXwkLPh1BTow..GRcREIXfZ7b70rHcmqVpL1EZyalZAZ24Hm26cBzajnXmKjmjNbZ5bAK9VDQ4ronAoFC5Xwh4LQqpLRhrCpA4uNwlKTt_8Ep6AcqcaCzKstaeCl46WlpI8fTOxUrpf3mlAkUiKRxRSANKNp1YVDd8i0rgBIZimW6u7m9zOCDWNrWnIyJIIcgD7mKWP2tGjXKh473MlaR1Q0VZzg-1MKFb-bGtgxoRg3C3qf-oOvUeES5o1bbSDvHCUuqh7IYHAT2_QrvIFASX";

require([
  "esri/config",
  "esri/Map",
  "esri/views/MapView",
  "esri/views/SceneView",
  "esri/layers/GeoJSONLayer",
  "esri/layers/SceneLayer",
  "esri/widgets/Search",
  "esri/widgets/Locate",
  "esri/widgets/Daylight",
  "esri/widgets/Expand",
  "esri/core/reactiveUtils",
  "esri/rest/places",
  "esri/rest/support/PlacesQueryParameters"
], function (esriConfig, Map, MapView, SceneView, GeoJSONLayer, SceneLayer, Search, Locate, Daylight, Expand, reactiveUtils, places, PlacesQueryParameters) {

  esriConfig.apiKey = ARCGIS_API_KEY;

  /* ---------- Sabitler ---------- */
  const GEOJSON_URL = "Data/muhtarlik_lokasyon.geojson";
  const ISTANBUL_CENTER = [28.9784, 41.0082];
  const PALETTE = { green: "#00E676", yellow: "#FFEA00", orange: "#FFB74D", red: "#D50000", navy: "#1A5276" };

  // Sinematik giriş kameraları (3D): Türkiye geneli → İstanbul'a eğimli yaklaşma.
  const TURKEY_CAMERA = { position: { longitude: 35.2, latitude: 36.0, z: 2400000 }, heading: 0, tilt: 18 };
  const ISTANBUL_CAMERA = { position: { longitude: 28.97, latitude: 40.96, z: 6500 }, heading: 20, tilt: 68 };

  // Altlık seçenekleri (Uydu / Yol / Arazi) ve gece altlığı.
  const BASEMAPS = { imagery: "arcgis/imagery", streets: "arcgis/navigation", terrain: "arcgis/topographic" };
  const NIGHT_BASEMAP = "streets-night-vector";

  /* ---------- RENDERER: Mahalle muhtarlıkları (noktasal) ---------- */
  // 8px sabit, içi beyaz, 2px Lacivert dış çizgi.
  const muhtarlikRenderer = {
    type: "simple",
    symbol: {
      type: "simple-marker",
      size: 8,
      color: "#FFFFFF",
      outline: { color: PALETTE.navy, width: 2 }
    }
  };

  // Field adlarında boşluk/Türkçe karakter olduğundan içerik fonksiyonla üretiliyor.
  const muhtarlikPopup = {
    title: "Mahalle Muhtarlığı",
    outFields: ["*"],
    content: function (event) {
      const a = event.graphic.attributes || {};
      const div = document.createElement("div");
      div.innerHTML =
        '<p><b>Mahalle:</b> ' + (a["Mahalle Adı"] || "-") + "</p>" +
        '<p><b>İlçe:</b> ' + (a["İlçe Adı"] || "-") + "</p>" +
        '<p><b>Muhtarlık:</b> ' + (a["Muhtarlık Adı"] || "-") + "</p>" +
        '<p><b>Adres:</b> ' + (a["Adres"] || "-") + "</p>";
      return div;
    }
  };

  // CLUSTER: 80px yarıçapında otomatik kümeleme.
  const clusterReduction = {
    type: "cluster",
    clusterRadius: "80px",
    clusterMinSize: "20px",
    clusterMaxSize: "50px",
    popupTemplate: {
      title: "Mahalle Kümesi",
      content: "Bu küme {cluster_count} mahalle muhtarlığını temsil ediyor."
    },
    labelingInfo: [{
      deconflictionStrategy: "none",
      labelExpressionInfo: { expression: "Text($feature.cluster_count, '#,###')" },
      symbol: { type: "text", color: "#0F2A3F", font: { weight: "bold", size: "12px" } },
      labelPlacement: "center-center"
    }]
  };

  const pointsLayer = new GeoJSONLayer({
    url: GEOJSON_URL,
    title: "Mahalle Muhtarlıkları",
    renderer: muhtarlikRenderer,
    popupTemplate: muhtarlikPopup,
    featureReduction: clusterReduction
  });

  /* ---------- RENDERER: Isı haritası (Heatmap) ---------- */
  // Yoğunluk: düşük→Yeşil, orta→Sarı, yüksek→Turuncu, kritik→Kırmızı.
  const heatmapRenderer = {
    type: "heatmap",
    radius: 20,
    maxDensity: 0.05,
    minDensity: 0,
    colorStops: [
      { ratio: 0.00, color: "rgba(0, 230, 118, 0)" },
      { ratio: 0.15, color: PALETTE.green },
      { ratio: 0.45, color: PALETTE.yellow },
      { ratio: 0.75, color: PALETTE.orange },
      { ratio: 1.00, color: PALETTE.red }
    ]
  };

  const heatLayer = new GeoJSONLayer({
    url: GEOJSON_URL,
    title: "Su Tüketim Yoğunluğu (Isı Haritası)",
    renderer: heatmapRenderer
  });

  /* ---------- 3D Binalar (OpenStreetMap 3D Buildings SceneLayer) ---------- */
  // Yalnızca 3D (SceneView) modunda çizilir; 2D'de yok sayılır.
  const buildingsLayer = new SceneLayer({
    url: "https://basemaps3d.arcgis.com/arcgis/rest/services/OpenStreetMap3D_Buildings_v1/SceneServer",
    title: "3D Binalar"
  });

  /* ---------- RENDERER: Gece şehir ışıkları (parlama) ---------- */
  // Radyal gradyanlı yumuşak bir ışık ikonu üretip picture-marker olarak kullanırız;
  // hem 2D hem 3D'de "şehir ışığı" parlaması verir. Yalnızca gece modunda görünür.
  function makeGlowIcon() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0.00, "rgba(255,248,214,1)");
    grad.addColorStop(0.25, "rgba(255,214,120,0.85)");
    grad.addColorStop(0.60, "rgba(255,176,77,0.35)");
    grad.addColorStop(1.00, "rgba(255,176,77,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c.toDataURL();
  }

  const cityLightsLayer = new GeoJSONLayer({
    url: GEOJSON_URL,
    title: "Şehir Işıkları",
    visible: false,
    renderer: {
      type: "simple",
      symbol: { type: "picture-marker", url: makeGlowIcon(), width: "26px", height: "26px" }
    }
  });

  /* ---------- Harita ---------- */
  // buildingsLayer (SceneLayer) haritaya yalnızca 3D'de eklenir (bkz. activateView):
  // MapView desteklemediği için 2D'de eklenirse layerview hatası verir.
  const map = new Map({
    basemap: "arcgis/topographic",
    ground: "world-elevation",
    layers: [heatLayer, cityLightsLayer, pointsLayer]
  });

  /* ---------- Görünüm (2D/3D ortak) ---------- */
  // MapView ve SceneView aynı "map" nesnesini paylaşır. Geçişte view'ler
  // YOK EDİLMEZ; çünkü view.destroy() paylaşılan haritayı da yok eder.
  // Her iki görünüm bir kez kurulur, ardından yalnızca container takas edilir
  // (ArcGIS'in resmi 2D↔3D geçiş kalıbı). Böylece aynı container'a iki view
  // bağlı kalmaz ve 3D render yüzeyi bozulmaz.
  let view, mapView, sceneView, searchWidget, locateWidget, daylightExpand, viewWatchHandle;
  let is3D = false, isNight = false, heatOn = true, selectedBasemap = "terrain";

  function getView(use3D, viewpoint) {
    let target;
    if (use3D) {
      if (!sceneView) {
        // İlk açılış Türkiye kamerasıyla başlar (sinematik giriş buradan yaklaşır).
        sceneView = new SceneView({ map: map, camera: TURKEY_CAMERA, qualityProfile: "high" });
      }
      target = sceneView;
    } else {
      if (!mapView) {
        mapView = new MapView({ map: map, center: ISTANBUL_CENTER, zoom: 10 });
      }
      target = mapView;
    }
    if (viewpoint) { target.viewpoint = viewpoint; }
    return target;
  }

  function mountWidgets() {
    if (searchWidget) { searchWidget.destroy(); }
    if (locateWidget) { locateWidget.destroy(); }
    if (daylightExpand) { daylightExpand.destroy(); daylightExpand = null; }
    // Search widget — İstanbul içi adres/konum araması.
    searchWidget = new Search({ view: view, container: "searchDiv" });
    // Locate widget — kullanıcının canlı konumu.
    locateWidget = new Locate({ view: view });
    view.ui.add(locateWidget, "top-left");
    // Daylight widget — yalnızca 3D'de: saat/tarih ile güneş ışığını düzenler.
    if (view.type === "3d") {
      view.environment.lighting = { type: "sun", directShadowsEnabled: true };
      const daylight = new Daylight({ view: view });
      daylightExpand = new Expand({
        view: view, content: daylight, expanded: false,
        expandIcon: "brightness", expandTooltip: "Gün Işığı / Saat"
      });
      view.ui.add(daylightExpand, "top-right");
    }
  }

  function activateView(use3D, viewpoint) {
    const next = getView(use3D, viewpoint);
    // Önce eski görünümü container'dan ayır (yok ETME), sonra yenisini bağla.
    if (view && view !== next) { view.container = null; }
    view = next;
    view.container = "viewDiv";
    // 3D binalar yalnızca SceneView'da desteklenir: 3D'de haritaya ekle, 2D'de çıkar.
    if (use3D) {
      if (!map.layers.includes(buildingsLayer)) { map.add(buildingsLayer, 0); }
    } else {
      map.remove(buildingsLayer);
    }
    mountWidgets();
    watchDistrict();
    view.when(function () {
      document.getElementById("loading").classList.add("hidden");
      updateDistrictLabel();
    });
  }

  /* ---------- İlçe adı göstergesi (merkeze en yakın mahalleye göre) ---------- */
  // İlçe sınır poligonumuz yok; yakınlaşınca harita merkezine en yakın mahalle
  // noktasının "İlçe Adı" değerini üstteki etikette gösteririz, merkez değiştikçe güncellenir.
  let muhtarliklar = [];                 // {lon, lat, ilce}
  const DISTRICT_SCALE = 200000;         // bu ölçeğin altında (daha yakın) göster

  function nearestIlce(center) {
    if (!center || !muhtarliklar.length) { return null; }
    const lon = center.longitude, lat = center.latitude;
    const kx = Math.cos(lat * Math.PI / 180);
    let best = null, bestD = Infinity;
    for (let i = 0; i < muhtarliklar.length; i++) {
      const m = muhtarliklar[i];
      const dx = (m.lon - lon) * kx, dy = m.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = m; }
    }
    return best ? best.ilce : null;
  }

  function updateDistrictLabel() {
    const label = document.getElementById("districtLabel");
    if (!label || !view) { return; }
    const near = view.scale && view.scale < DISTRICT_SCALE;
    const ilce = near ? nearestIlce(view.center) : null;
    if (ilce) {
      label.textContent = "📍 " + ilce;
      label.classList.remove("hidden");
    } else {
      label.classList.add("hidden");
    }
  }

  function watchDistrict() {
    if (viewWatchHandle) { viewWatchHandle.remove(); }
    // view.stationary/scale/center reaktif izlenir; her değişimde etiket güncellenir.
    viewWatchHandle = reactiveUtils.watch(
      function () { return [view.stationary, view.scale, view.center]; },
      function () { updateDistrictLabel(); }
    );
  }

  // Mahalle noktalarını ilçe göstergesi için belleğe al.
  fetch(encodeURI(GEOJSON_URL))
    .then(function (r) { return r.json(); })
    .then(function (gj) {
      muhtarliklar = (gj.features || []).map(function (f) {
        return {
          lon: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
          ilce: f.properties["İlçe Adı"] || ""
        };
      });
      updateDistrictLabel();
    })
    .catch(function () {});

  /* ---------- Açılış: 3D + sinematik Türkiye → İstanbul ---------- */
  is3D = true;
  activateView(true);
  sceneView.when(function () {
    // Türkiye genelinden İstanbul'a yumuşak (sinematik) yaklaşma — yalnızca bir kez.
    sceneView.goTo(ISTANBUL_CAMERA, { duration: 4500, easing: "in-out-cubic" }).catch(function () {});
  });

  /* ---------- Kontroller ---------- */
  const $ = function (id) { return document.getElementById(id); };

  // Altlığı uygula: gece modunda karanlık altlık; değilse seçili altlık (Uydu/Yol/Arazi).
  function applyBasemap() {
    map.basemap = isNight ? NIGHT_BASEMAP : BASEMAPS[selectedBasemap];
  }

  function markBasemapButtons() {
    $("bmImagery").classList.toggle("active", selectedBasemap === "imagery");
    $("bmStreets").classList.toggle("active", selectedBasemap === "streets");
    $("bmTerrain").classList.toggle("active", selectedBasemap === "terrain");
  }
  markBasemapButtons();

  // Uydu / Yol / Arazi altlık geçişi.
  [["bmImagery", "imagery"], ["bmStreets", "streets"], ["bmTerrain", "terrain"]].forEach(function (pair) {
    $(pair[0]).addEventListener("click", function () {
      selectedBasemap = pair[1];
      markBasemapButtons();
      applyBasemap();
    });
  });

  // Gündüz / Gece modu — gece: karanlık altlık + şehir ışığı parlamaları.
  $("basemapToggle").addEventListener("click", function () {
    isNight = !isNight;
    applyBasemap();
    cityLightsLayer.visible = isNight;
    this.textContent = isNight ? "☀️ Gündüz Modu" : "🌙 Gece Modu";
    this.classList.toggle("active", isNight);
  });

  // 2D / 3D geçişi — kamera/koordinat kilitli (viewpoint korunur).
  $("dimToggle").addEventListener("click", function () {
    const vp = view.viewpoint ? view.viewpoint.clone() : null;
    is3D = !is3D;
    document.getElementById("loading").classList.remove("hidden");
    activateView(is3D, vp);
    this.textContent = is3D ? "🗺️ 2D'ye Geç" : "🧊 3D'ye Geç";
    this.classList.toggle("active", is3D);
  });

  // Isı haritası aç/kapat.
  $("heatToggle").addEventListener("click", function () {
    heatOn = !heatOn;
    heatLayer.visible = heatOn;
    this.textContent = heatOn ? "🔥 Isı Haritası: Açık" : "🔥 Isı Haritası: Kapalı";
    this.classList.toggle("active", !heatOn);
  });

  // Places API — merkezin 1000 m çevresindeki yeşil alan/rekreasyon odakları.
  $("placesBtn").addEventListener("click", async function () {
    const list = $("placesList");
    list.innerHTML = "<li class='hint'>Sorgulanıyor…</li>";
    try {
      const params = new PlacesQueryParameters({
        apiKey: ARCGIS_API_KEY,
        point: view.center,
        radius: 1000,
        categoryIds: ["4bf58dd8d48988d163941735"]
      });
      const res = await places.queryPlacesNearPoint(params);
      const items = (res && res.results) || [];
      if (!items.length) {
        list.innerHTML = "<li class='hint'>Bu çevrede kayıt bulunamadı.</li>";
        return;
      }
      list.innerHTML = "";
      items.slice(0, 25).forEach(function (p) {
        const li = document.createElement("li");
        const dist = (p.distance != null) ? '<span class="dist"> · ' + Math.round(p.distance) + " m</span>" : "";
        li.innerHTML = (p.name || "İsimsiz") + dist;
        list.appendChild(li);
      });
    } catch (e) {
      list.innerHTML = "<li class='hint'>Sorgu başarısız: " + e.message + " (Geçerli API anahtarı gerekli)</li>";
    }
  });

  /* ---------- Sol panel grafikleri (yerel JSON) ---------- */
  const fmt = new Intl.NumberFormat("tr-TR");

  function rampColor(ratio) {
    if (ratio < 0.4) return PALETTE.green;
    if (ratio < 0.7) return PALETTE.yellow;
    if (ratio < 0.9) return PALETTE.orange;
    return PALETTE.red;
  }

  function renderBars(containerId, rows) {
    const host = $(containerId);
    if (!rows.length) { host.innerHTML = "<span class='hint'>Veri yok.</span>"; return; }
    const max = Math.max.apply(null, rows.map(function (r) { return r.val; }));
    host.innerHTML = "";
    rows.forEach(function (r) {
      const ratio = max ? r.val / max : 0;
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML =
        '<span class="yr">' + r.yr + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="width:' +
        (ratio * 100).toFixed(1) + "%;background:" + rampColor(ratio) + '"></span></span>' +
        '<span class="val">' + fmt.format(Math.round(r.val)) + "</span>";
      host.appendChild(row);
    });
  }

  // Türkçe karakterli / boşluklu dosya adları encodeURI ile çözülür.
  function loadJson(path) {
    return fetch(encodeURI(path)).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + path);
      return r.json();
    });
  }

  // Yeşil alanlar için harcanan su (yıl=indeks 1, değer=indeks 2)
  loadJson("Data/Yıllara Göre Yeşil Alanlar İçin Harcanan Su Miktarı.json")
    .then(function (d) {
      const rows = d.records.map(function (rec) { return { yr: rec[1], val: parseFloat(rec[2]) }; });
      renderBars("waterChart", rows);
    })
    .catch(function (e) { $("waterChart").innerHTML = "<span class='hint'>Yüklenemedi: " + e.message + "</span>"; });

  // İBB birimleri yıllık su tüketimi (yıl=indeks 1, değer=indeks 3)
  loadJson("Data/İBB Birimleri Su Tüketimi.json")
    .then(function (d) {
      const rows = d.records.map(function (rec) { return { yr: rec[1], val: parseFloat(rec[3]) }; });
      renderBars("ibbChart", rows);
    })
    .catch(function (e) { $("ibbChart").innerHTML = "<span class='hint'>Yüklenemedi: " + e.message + "</span>"; });

});
