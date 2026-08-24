(function(){
  "use strict";

  /* ============================================================
     STATE
  ============================================================ */
  const state = {
    sessionCode: null,
    name: null,
    clientId: 'c' + Math.random().toString(36).slice(2, 10),
    color: null,
    annotations: [],
    presence: {},
    lastAnnotationsWrite: 0,
    dxVotes: {},
  };

  /* ---------- Fictional training case: labs + differential ---------- */
  const LAB_TESTS = [
    { name:'Troponin I',        value:'4.80',  unit:'ng/mL', range:'< 0.04',        flag:'high' },
    { name:'CK-MB',              value:'38',     unit:'ng/mL', range:'0–5',           flag:'high' },
    { name:'BNP',                 value:'210',    unit:'pg/mL', range:'< 100',         flag:'high' },
    { name:'LDL Cholesterol',   value:'168',    unit:'mg/dL', range:'< 100',         flag:'high' },
    { name:'HDL Cholesterol',  value:'38',     unit:'mg/dL', range:'> 40',           flag:'low' },
    { name:'WBC',                  value:'9.8',    unit:'K/µL',  range:'4.5–11.0',    flag:'normal' },
    { name:'Hemoglobin',        value:'14.1',   unit:'g/dL',  range:'13.5–17.5',   flag:'normal' },
    { name:'Potassium',          value:'4.2',    unit:'mmol/L',range:'3.5–5.0',      flag:'normal' },
    { name:'Creatinine',         value:'1.0',    unit:'mg/dL', range:'0.7–1.3',      flag:'normal' },
  ];
  const DX_OPTIONS = [
    'ST-Elevation Myocardial Infarction (STEMI)',
    'Unstable Angina',
    'Acute Pericarditis',
    'Pulmonary Embolism',
    'Aortic Dissection',
  ];

  const PALETTE = ['#49d9c2', '#f2a65a', '#7aa2ff', '#e8607a', '#c792ea', '#7fd992'];
  function colorForName(name){
    let h = 0;
    for (let i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /* ============================================================
     JOIN FLOW
  ============================================================ */
  const joinOverlay = document.getElementById('join-overlay');
  const inName = document.getElementById('in-name');
  const inCode = document.getElementById('in-code');

  document.getElementById('gen-code-btn').onclick = () => {
    inCode.value = 'STUDY-' + Math.floor(1000 + Math.random()*9000);
  };

  document.getElementById('join-btn').onclick = () => {
    const name = inName.value.trim() || 'Guest';
    const code = (inCode.value.trim() || 'STUDY-0001').toUpperCase();
    state.name = name.slice(0,18);
    state.sessionCode = code;
    state.color = colorForName(name + code);
    document.getElementById('chip-code').textContent = code;
    joinOverlay.style.display = 'none';
    document.getElementById('topbar').style.display = 'flex';
    document.getElementById('signal-strip').style.display = 'flex';
    document.getElementById('annotation-panel').style.display = 'flex';
    document.getElementById('labs-panel').style.display = 'flex';
    renderLabsTable();
    renderDxList();
    startSync();
    animate();
  };

  /* ============================================================
     THREE.JS SCENE
  ============================================================ */
  const root = document.getElementById('scene-root');
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0f1a, 0.045);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.05, 100);
  let camDist = 3.4, camTheta = 0.5, camPhi = 1.15;
  function updateCameraFromOrbit(){
    camera.position.set(
      camDist * Math.sin(camPhi) * Math.sin(camTheta),
      camDist * Math.cos(camPhi) + 1.1,
      camDist * Math.sin(camPhi) * Math.cos(camTheta)
    );
    camera.lookAt(0, 1.1, 0);
  }
  updateCameraFromOrbit();

  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.setClearColor(0x0a0f1a);
  root.appendChild(renderer.domElement);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Lighting: clinical glow
  scene.add(new THREE.AmbientLight(0x223046, 1.6));
  const key = new THREE.PointLight(0x49d9c2, 1.4, 12);
  key.position.set(2, 3, 2);
  scene.add(key);
  const rim = new THREE.PointLight(0xf2a65a, 0.7, 12);
  rim.position.set(-2.5, 1.5, -2);
  scene.add(rim);
  const fill = new THREE.PointLight(0x7aa2ff, 0.5, 10);
  fill.position.set(0, 2, -3);
  scene.add(fill);

  // Floor grid — "study room" plane
  const grid = new THREE.GridHelper(14, 28, 0x22304a, 0x141f33);
  grid.position.y = 0;
  scene.add(grid);
  const floorMat = new THREE.MeshBasicMaterial({ color:0x0a0f1a, transparent:true, opacity:0.001 });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(14,14), floorMat));

  // Pedestal
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.9, 32),
    new THREE.MeshStandardMaterial({ color:0x111a2c, metalness:0.3, roughness:0.6 })
  );
  pedestal.position.y = 0.45;
  scene.add(pedestal);
  const pedestalRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.56, 0.012, 8, 48),
    new THREE.MeshBasicMaterial({ color:0x49d9c2 })
  );
  pedestalRing.rotation.x = Math.PI/2;
  pedestalRing.position.y = 0.9;
  scene.add(pedestalRing);

  /* ---------- Stylized study specimen: a heart, built from primitives ---------- */
  const specimen = new THREE.Group();
  specimen.position.y = 1.05;
  scene.add(specimen);

  const oxyMat = new THREE.MeshStandardMaterial({ color:0xc2455a, roughness:0.45, metalness:0.05, emissive:0x2a0a10, emissiveIntensity:0.4 });
  const deoxyMat = new THREE.MeshStandardMaterial({ color:0x3b5fc4, roughness:0.45, metalness:0.05, emissive:0x0a1230, emissiveIntensity:0.4 });

  const parts = [];
  function addPart(name, mesh, labelColor){
    mesh.userData.partName = name;
    mesh.userData.labelColor = labelColor || '#e8ecf1';
    mesh.userData.baseScale = mesh.scale.clone();
    specimen.add(mesh);
    parts.push(mesh);
    return mesh;
  }

  const leftVentricle = addPart('Left Ventricle',
    new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 32), oxyMat), '#f28aa0');
  leftVentricle.position.set(0.13, -0.05, 0.02);
  leftVentricle.scale.set(1, 1.25, 1);

  const rightVentricle = addPart('Right Ventricle',
    new THREE.Mesh(new THREE.SphereGeometry(0.24, 32, 32), deoxyMat), '#9db6f2');
  rightVentricle.position.set(-0.18, -0.07, -0.02);
  rightVentricle.scale.set(1, 1.15, 1);

  const leftAtrium = addPart('Left Atrium',
    new THREE.Mesh(new THREE.SphereGeometry(0.155, 24, 24), oxyMat), '#f28aa0');
  leftAtrium.position.set(0.16, 0.26, -0.05);

  const rightAtrium = addPart('Right Atrium',
    new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), deoxyMat), '#9db6f2');
  rightAtrium.position.set(-0.19, 0.24, 0.04);

  const aortaCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, 0.34, 0),
    new THREE.Vector3(0.02, 0.52, -0.06),
    new THREE.Vector3(-0.12, 0.58, -0.1),
    new THREE.Vector3(-0.3, 0.5, -0.06),
  ]);
  const aorta = addPart('Aorta',
    new THREE.Mesh(new THREE.TubeGeometry(aortaCurve, 32, 0.045, 12, false), oxyMat), '#f28aa0');

  const pulmCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.15, 0.32, 0.05),
    new THREE.Vector3(-0.22, 0.46, 0.12),
    new THREE.Vector3(-0.1, 0.54, 0.2),
    new THREE.Vector3(0.08, 0.5, 0.18),
  ]);
  const pulmArtery = addPart('Pulmonary Artery',
    new THREE.Mesh(new THREE.TubeGeometry(pulmCurve, 32, 0.04, 12, false), deoxyMat), '#9db6f2');

  const septum = addPart('Interventricular Septum',
    new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.28), new THREE.MeshStandardMaterial({ color:0x8a4a55, roughness:0.6 })), '#d9a8b0');
  septum.position.set(-0.03, -0.05, 0);
  septum.rotation.y = 0.15;

  const svc = addPart('Superior Vena Cava',
    new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.28, 16), deoxyMat), '#9db6f2');
  svc.position.set(-0.22, 0.42, 0.02);
  svc.rotation.z = 0.25;

  const ivc = addPart('Inferior Vena Cava',
    new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 16), deoxyMat), '#9db6f2');
  ivc.position.set(-0.24, -0.22, 0.02);
  ivc.rotation.z = -0.2;

  const pulmVeinCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.25, 0.32, -0.1),
    new THREE.Vector3(0.32, 0.4, -0.02),
    new THREE.Vector3(0.28, 0.34, 0.08),
    new THREE.Vector3(0.18, 0.28, 0.02),
  ]);
  const pulmVeins = addPart('Pulmonary Veins',
    new THREE.Mesh(new THREE.TubeGeometry(pulmVeinCurve, 24, 0.03, 8, false), oxyMat), '#f28aa0');

  const valveMat = new THREE.MeshStandardMaterial({ color:0xe8ecf1, roughness:0.3, metalness:0.2 });
  const mitralValve = addPart('Mitral Valve',
    new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 10, 24), valveMat), '#e8ecf1');
  mitralValve.position.set(0.15, 0.12, 0);
  mitralValve.rotation.x = Math.PI/2.3;

  const tricuspidValve = addPart('Tricuspid Valve',
    new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 10, 24), valveMat), '#e8ecf1');
  tricuspidValve.position.set(-0.18, 0.11, 0);
  tricuspidValve.rotation.x = Math.PI/2.3;

  const aorticValve = addPart('Aortic Valve',
    new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 20), new THREE.MeshStandardMaterial({ color:0xf2d9df, roughness:0.3 })), '#f2d9df');
  aorticValve.position.set(0.07, 0.33, 0);
  aorticValve.rotation.x = Math.PI/2;

  const pulmonaryValve = addPart('Pulmonary Valve',
    new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 8, 20), new THREE.MeshStandardMaterial({ color:0xd9e4f2, roughness:0.3 })), '#d9e4f2');
  pulmonaryValve.position.set(-0.14, 0.31, 0.03);
  pulmonaryValve.rotation.x = Math.PI/2;

  const ladCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.06, 0.3, 0.16),
    new THREE.Vector3(0.1, 0.12, 0.2),
    new THREE.Vector3(0.1, -0.08, 0.19),
    new THREE.Vector3(0.06, -0.24, 0.14),
  ]);
  const lad = addPart('Left Anterior Descending Artery',
    new THREE.Mesh(new THREE.TubeGeometry(ladCurve, 24, 0.014, 8, false), new THREE.MeshStandardMaterial({ color:0xf2a65a, roughness:0.4, emissive:0x3a2205, emissiveIntensity:0.5 })), '#f2a65a');

  const rcaCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.1, 0.3, -0.16),
    new THREE.Vector3(-0.2, 0.14, -0.18),
    new THREE.Vector3(-0.22, -0.06, -0.15),
    new THREE.Vector3(-0.14, -0.2, -0.12),
  ]);
  const rca = addPart('Right Coronary Artery',
    new THREE.Mesh(new THREE.TubeGeometry(rcaCurve, 24, 0.014, 8, false), new THREE.MeshStandardMaterial({ color:0xf2a65a, roughness:0.4, emissive:0x3a2205, emissiveIntensity:0.5 })), '#f2a65a');

  // Gentle idle rotation + breathing scale
  let idleT = 0;

  // Glow wireframe shell for hover emphasis
  const glowGeo = new THREE.IcosahedronGeometry(0.62, 2);
  const glowMat = new THREE.MeshBasicMaterial({ color:0x49d9c2, wireframe:true, transparent:true, opacity:0.05 });
  const glowShell = new THREE.Mesh(glowGeo, glowMat);
  glowShell.position.set(-0.03, 0.08, 0);
  specimen.add(glowShell);

  /* ============================================================
     CUSTOM ORBIT (mouse + touch) — no external controls dependency
  ============================================================ */
  let dragging = false, lastX = 0, lastY = 0;
  const dom = renderer.domElement;

  function pointerDown(x,y){ dragging = true; lastX = x; lastY = y; }
  function pointerMove(x,y){
    if (!dragging) return;
    const dx = x - lastX, dy = y - lastY;
    camTheta -= dx * 0.006;
    camPhi = Math.min(2.6, Math.max(0.35, camPhi - dy * 0.006));
    lastX = x; lastY = y;
    updateCameraFromOrbit();
  }
  function pointerUp(){ dragging = false; }

  dom.addEventListener('mousedown', e => pointerDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => pointerMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', pointerUp);
  dom.addEventListener('touchstart', e => { if(e.touches.length===1) pointerDown(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
  dom.addEventListener('touchmove', e => { if(e.touches.length===1) pointerMove(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
  dom.addEventListener('touchend', pointerUp);
  dom.addEventListener('wheel', e => {
    camDist = Math.min(7, Math.max(1.6, camDist + e.deltaY * 0.0025));
    updateCameraFromOrbit();
  }, {passive:true});

  /* ============================================================
     RAYCAST — hover + click on specimen parts
  ============================================================ */
  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();
  let hovered = null;
  const hoverLabel = document.getElementById('hover-label');

  function ndcFromEvent(x, y){
    mouseNDC.x = (x / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(y / window.innerHeight) * 2 + 1;
  }

  dom.addEventListener('mousemove', e => {
    if (dragging) { hoverLabel.style.display = 'none'; return; }
    ndcFromEvent(e.clientX, e.clientY);
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(parts, false);
    if (hits.length){
      hovered = hits[0].object;
      hoverLabel.textContent = hovered.userData.partName;
      hoverLabel.style.left = e.clientX + 'px';
      hoverLabel.style.top = e.clientY + 'px';
      hoverLabel.style.display = 'block';
      hoverLabel.style.color = hovered.userData.labelColor;
      dom.style.cursor = 'pointer';
    } else {
      hovered = null;
      hoverLabel.style.display = 'none';
      dom.style.cursor = 'grab';
    }
  });

  let downX=0, downY=0;
  dom.addEventListener('mousedown', e => { downX=e.clientX; downY=e.clientY; });
  dom.addEventListener('mouseup', e => {
    if (Math.hypot(e.clientX-downX, e.clientY-downY) > 5) return; // was a drag
    if (!hovered) return;
    openNotePopup(hovered, e.clientX, e.clientY);
  });

  /* ============================================================
     NOTE / ANNOTATION POPUP
  ============================================================ */
  const notePopup = document.getElementById('note-popup');
  const npPartLabel = document.getElementById('np-part-label');
  const npText = document.getElementById('np-text');
  let pendingPart = null;

  function openNotePopup(mesh, screenX, screenY){
    pendingPart = mesh;
    npPartLabel.textContent = mesh.userData.partName;
    npPartLabel.style.color = mesh.userData.labelColor;
    npText.value = '';
    const left = Math.min(screenX, window.innerWidth - 250);
    const top = Math.min(screenY, window.innerHeight - 170);
    notePopup.style.left = left + 'px';
    notePopup.style.top = top + 'px';
    notePopup.style.display = 'block';
    setTimeout(()=>npText.focus(), 30);
  }
  document.getElementById('np-cancel').onclick = () => { notePopup.style.display='none'; };
  document.getElementById('np-save').onclick = () => {
    const text = npText.value.trim();
    if (!text || !pendingPart) { notePopup.style.display='none'; return; }
    const p = pendingPart.getWorldPosition(new THREE.Vector3());
    const note = {
      id: 'n' + Date.now() + Math.random().toString(36).slice(2,6),
      part: pendingPart.userData.partName,
      author: state.name,
      color: state.color,
      text: text.slice(0,200),
      x: p.x, y: p.y, z: p.z,
      ts: Date.now()
    };
    state.annotations.push(note);
    renderAnnotationList();
    addPinMesh(note);
    pushAnnotations();
    notePopup.style.display = 'none';
  };

  /* ============================================================
     PINS (3D markers for annotations) + panel list
  ============================================================ */
  const pinGroup = new THREE.Group();
  scene.add(pinGroup);
  const pinMeshes = {};

  function addPinMesh(note){
    if (pinMeshes[note.id]) return;
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.028, 0),
      new THREE.MeshBasicMaterial({ color: note.color || '#f2a65a' })
    );
    m.position.set(note.x, note.y, note.z);
    m.userData.note = note;
    pinGroup.add(m);
    pinMeshes[note.id] = m;
  }

  function renderAnnotationList(){
    const list = document.getElementById('ap-list');
    const sorted = [...state.annotations].sort((a,b)=>b.ts-a.ts);
    list.innerHTML = '';
    sorted.forEach(n => {
      const div = document.createElement('div');
      div.className = 'note-item';
      div.innerHTML = `<div class="note-top">
          <span class="note-part">${escapeHtml(n.part)}</span>
          <span class="note-author">— ${escapeHtml(n.author)}</span>
        </div>
        <div class="note-text">${escapeHtml(n.text)}</div>`;
      list.appendChild(div);
    });
    document.getElementById('ap-count').textContent = state.annotations.length;
  }
  function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

  document.getElementById('ap-header').onclick = () => {
    document.getElementById('annotation-panel').classList.toggle('panel-collapsed');
  };

  /* ============================================================
     LABS TABLE + TEAM DIFFERENTIAL DIAGNOSIS
  ============================================================ */
  function renderLabsTable(){
    const table = document.getElementById('labs-table');
    table.innerHTML = '';
    LAB_TESTS.forEach(t => {
      const row = document.createElement('div');
      row.className = 'lab-row';
      row.innerHTML = `
        <div class="lab-name">${escapeHtml(t.name)}<br><span style="color:var(--slate);font-size:10px;">ref ${escapeHtml(t.range)} ${escapeHtml(t.unit)}</span></div>
        <div class="lab-value">${escapeHtml(t.value)} ${escapeHtml(t.unit)}</div>
        <div class="lab-flag ${t.flag}">${t.flag === 'normal' ? 'WNL' : t.flag.toUpperCase()}</div>`;
      table.appendChild(row);
    });
  }

  function renderDxList(){
    const list = document.getElementById('dx-list');
    const total = Object.keys(state.dxVotes).length;
    const myVote = state.dxVotes[state.clientId] ? state.dxVotes[state.clientId].choice : null;
    list.innerHTML = '';
    DX_OPTIONS.forEach(opt => {
      const voters = Object.values(state.dxVotes).filter(v => v.choice === opt);
      const pct = total ? Math.round((voters.length/total)*100) : 0;
      const div = document.createElement('div');
      div.className = 'dx-option' + (myVote === opt ? ' selected' : '');
      div.innerHTML = `
        <div class="dx-top">
          <span class="dx-label">${escapeHtml(opt)}</span>
          <span class="dx-count">${voters.length}</span>
        </div>
        <div class="dx-bar-track"><div class="dx-bar-fill" style="width:${pct}%;"></div></div>
        <div class="dx-voters">${voters.map(v=>escapeHtml(v.name)).join(', ')}</div>`;
      div.onclick = () => castDxVote(opt);
      list.appendChild(div);
    });
  }

  async function castDxVote(choice){
    state.dxVotes[state.clientId] = { name: state.name, color: state.color, choice, ts: Date.now() };
    renderDxList();
    try {
      const key = 'diagnosis:' + state.sessionCode;
      let map = {};
      try {
        const res = await window.storage.get(key, true);
        if (res) map = JSON.parse(res.value || '{}');
      } catch(e) {}
      map[state.clientId] = state.dxVotes[state.clientId];
      await window.storage.set(key, JSON.stringify(map), true);
    } catch (e) { console.error('diagnosis vote sync failed', e); }
  }

  async function pullDxVotes(){
    try {
      const res = await window.storage.get('diagnosis:' + state.sessionCode, true);
      if (!res) return;
      const remote = JSON.parse(res.value || '{}');
      state.dxVotes = remote;
      renderDxList();
    } catch (e) { /* key may not exist yet */ }
  }

  document.getElementById('labs-collapse-btn').onclick = () => {
    document.getElementById('labs-panel').classList.toggle('panel-collapsed');
  };
  document.getElementById('labs-toggle-btn').onclick = () => {
    const panel = document.getElementById('labs-panel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  };

  /* ============================================================
     STORAGE SYNC — presence + shared annotations
  ============================================================ */
  async function pushAnnotations(){
    state.lastAnnotationsWrite = Date.now();
    try {
      await window.storage.set('annotations:' + state.sessionCode, JSON.stringify(state.annotations), true);
    } catch (e) { console.error('annotation sync failed', e); }
  }

  async function pullAnnotations(){
    try {
      const res = await window.storage.get('annotations:' + state.sessionCode, true);
      if (!res) return;
      const remote = JSON.parse(res.value || '[]');
      // merge by id, keep union (simple last-write-wins on the whole list already handled by set())
      const knownIds = new Set(state.annotations.map(n=>n.id));
      let changed = false;
      remote.forEach(n => {
        if (!knownIds.has(n.id)) {
          state.annotations.push(n);
          addPinMesh(n);
          changed = true;
        }
      });
      if (changed) renderAnnotationList();
    } catch (e) { /* key may not exist yet */ }
  }

  async function pushPresence(){
    try {
      const key = 'presence:' + state.sessionCode;
      let map = {};
      try {
        const res = await window.storage.get(key, true);
        if (res) map = JSON.parse(res.value || '{}');
      } catch(e) {}
      map[state.clientId] = {
        name: state.name, color: state.color,
        theta: camTheta, ts: Date.now()
      };
      // prune stale (>15s)
      Object.keys(map).forEach(id => { if (Date.now() - map[id].ts > 15000) delete map[id]; });
      await window.storage.set(key, JSON.stringify(map), true);
      state.presence = map;
      renderSignalStrip();
    } catch (e) { console.error('presence sync failed', e); }
  }

  function renderSignalStrip(){
    const list = document.getElementById('signal-list');
    list.innerHTML = '';
    const entries = Object.entries(state.presence);
    entries.forEach(([id, p]) => {
      const isYou = id === state.clientId;
      const stale = Date.now() - p.ts > 15000;
      if (stale) return;
      const div = document.createElement('div');
      div.className = 'signal-node' + (isYou ? ' signal-you' : '');
      div.innerHTML = `
        <div class="pulse-dot" style="background:${p.color};color:${p.color};"></div>
        <div class="who">
          <div class="who-name">${escapeHtml(p.name)}${isYou ? ' (you)' : ''}</div>
          <div class="who-status">${isYou ? 'this device' : 'live'}</div>
        </div>`;
      list.appendChild(div);
    });
  }

  function startSync(){
    pushPresence();
    pullAnnotations();
    pullDxVotes();
    setInterval(pushPresence, 4000);
    setInterval(pullAnnotations, 3000);
    setInterval(pullDxVotes, 3000);
  }

  /* ============================================================
     WEBXR
  ============================================================ */
  const vrBtn = document.getElementById('vr-btn');
  const vrLabel = document.getElementById('vr-btn-label');
  vrBtn.disabled = true;

  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then(supported => {
      vrBtn.disabled = !supported;
      vrLabel.textContent = supported ? 'Enter VR' : 'No headset detected';
      if (supported) vrBtn.classList.add('ready');
    }).catch(() => { vrLabel.textContent = 'VR unavailable'; });
  } else {
    vrLabel.textContent = 'WebXR not supported here';
  }

  let xrSession = null;
  vrBtn.addEventListener('click', async () => {
    if (vrBtn.disabled) return;
    if (!xrSession) {
      try {
        xrSession = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
        renderer.xr.setSession(xrSession);
        vrLabel.textContent = 'Exit VR';
        xrSession.addEventListener('end', () => {
          xrSession = null;
          vrLabel.textContent = 'Enter VR';
        });
      } catch (e) {
        vrLabel.textContent = 'Could not start VR';
      }
    } else {
      xrSession.end();
    }
  });

  /* ============================================================
     RENDER LOOP
  ============================================================ */
  function animate(){
    renderer.setAnimationLoop(() => {
      idleT += 0.01;
      specimen.rotation.y = Math.sin(idleT*0.3) * 0.15 + idleT*0.05;
      const beat = 1 + Math.sin(idleT*2.4)*0.02;
      leftVentricle.scale.set(beat, 1.25*beat, beat);
      rightVentricle.scale.set(beat, 1.15*beat, beat);
      glowShell.rotation.y += 0.0015;
      pinGroup.children.forEach((m,i)=>{ m.rotation.y += 0.02; m.position.y += Math.sin(idleT*2+i)*0.00015; });
      renderer.render(scene, camera);
    });
  }
})();