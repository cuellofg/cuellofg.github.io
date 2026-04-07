
const API_URL = 'https://guardias-api-dzatbfhae4hyhpeq.centralus-01.azurewebsites.net/api/guardias-api';
const ADMIN_PASS = 'Admin2026';
const DIAS_SEM = ['D','L','M','M','J','V','S'];

let cfg = JSON.parse(localStorage.getItem('grd_cfg') || 'null') || {
  mes:'ABRIL 2026', dias:30, inicioSem:1,
  tipos:[
    {cod:'G',desc:'Guardia',color:'#10b981'},
    {cod:'M/T',desc:'Manana y Tarde',color:'#3b82f6'},
    {cod:'M',desc:'Solo Manana',color:'#f59e0b'},
    {cod:'T',desc:'Solo Tarde',color:'#8b5cf6'},
    {cod:'LC',desc:'Licencia',color:'#ef4444'},
    {cod:'VAC',desc:'Vacaciones',color:'#ec4899'},
  ]
};
let personal = [];
let registros = {};
let usuarioActual = null;
let tipoSel = null;

function svLocal(k){ if(k==='cfg') localStorage.setItem('grd_cfg', JSON.stringify(cfg)); }

async function apiGet(tipo){
  try{
    const url = tipo ? API_URL+'?tipo='+tipo : API_URL;
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    return await r.json();
  } catch(e){ console.error('Error GET:', e); return []; }
}

async function apiPost(data, tipo){
  try{
    const url = tipo ? API_URL+'?tipo='+tipo : API_URL;
    await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data), signal: AbortSignal.timeout(30000) });
  } catch(e){ console.error('Error POST:', e); }
}

async function apiDelete(data, tipo){
  try{
    const url = tipo ? API_URL+'?tipo='+tipo : API_URL;
    await fetch(url, { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data), signal: AbortSignal.timeout(30000) });
  } catch(e){ console.error('Error DELETE:', e); }
}

async function cargarPersonal(){
  const data = await apiGet('personal');
  personal = data.filter(d => d.nombre);
  personal.sort((a,b) => (a.orden||0) - (b.orden||0));
}

async function cargarConfig(){
  const data = await apiGet('config');
  const cfgAzure = data.find(d => d.id === 'configuracion');
  if(cfgAzure && cfgAzure.tipos){
    cfg.tipos = cfgAzure.tipos;
  }
  if(cfgAzure && cfgAzure.mes) cfg.mes = cfgAzure.mes;
  if(cfgAzure && cfgAzure.dias) cfg.dias = cfgAzure.dias;
  if(cfgAzure && cfgAzure.inicioSem !== undefined) cfg.inicioSem = cfgAzure.inicioSem;
}

async function cargarRegistros(){
  const data = await apiGet();
  registros = {};
  data.forEach(d => {
    if(d.nombre && d.dia && d.tipo){
      if(!registros[d.nombre]) registros[d.nombre]={};
      registros[d.nombre][d.dia]=d.tipo;
    }
  });
}

function togglePass(id, btn){
  const inp=document.getElementById(id);
  if(inp.type==='password'){
    inp.type='text';
    btn.style.color='#3b82f6';
  } else {
    inp.type='password';
    btn.style.color='#94a3b8';
  }
}

function goTo(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  tipoSel=null;
  document.querySelectorAll('.tipo-btn').forEach(b=>b.classList.remove('sel'));
  document.getElementById('home-mes').textContent=cfg.mes;
}

async function iniciarLogin(){
  goTo('sc-login');
  document.getElementById('login-loader').style.display='block';
  document.getElementById('login-form').style.display='none';
  await cargarConfig();
  await cargarPersonal();
  llenarNombresLogin();
  document.getElementById('login-loader').style.display='none';
  document.getElementById('login-form').style.display='block';
}

function llenarSel(id,arr,vFn,lFn,empty){
  const s=document.getElementById(id); if(!s) return;
  s.innerHTML='<option value="">'+(empty||'Selecciona')+'</option>';
  arr.forEach((x,i)=>{const o=document.createElement('option');o.value=vFn(x,i);o.textContent=lFn(x,i);s.appendChild(o);});
}
function llenarPersonas(id){llenarSel(id,personal,p=>p.nombre,p=>p.nombre);}
function llenarTipos(id){llenarSel(id,cfg.tipos,t=>t.cod,t=>t.cod+' - '+t.desc);}
function llenarNombresLogin(){llenarSel('sel-nombre',personal,(_,i)=>i,p=>p.nombre,'Tu nombre');}

function doLogin(){
  const idx=document.getElementById('sel-nombre').value;
  const pass=document.getElementById('inp-pass').value;
  const err=document.getElementById('login-err');
  if(idx===''){err.textContent='Selecciona tu nombre.';err.style.display='block';return;}
  if(!pass){err.textContent='Ingresa tu contrasena.';err.style.display='block';return;}
  const p=personal[idx];
  if(p.pass!==pass){err.textContent='Contrasena incorrecta.';err.style.display='block';return;}
  err.style.display='none';
  document.getElementById('inp-pass').value='';
  usuarioActual={idx:parseInt(idx),...p};
  const dia=new Date().getDate();
  const yaReg=registros[p.nombre]&&registros[p.nombre][dia];
  document.getElementById('reg-title').textContent='Hola, '+p.nombre.split(',')[0];
  document.getElementById('reg-info').innerHTML=yaReg
    ?'<div class="alert alert-ok">Ya registraste <strong>'+yaReg+'</strong> hoy dia '+dia+'.</div>'
    :'<div style="font-size:13px;color:#64748b;">Hoy es el dia <strong>'+dia+'</strong> de '+cfg.mes+'</div>';
  renderTiposGrid();
  document.getElementById('rango-desde').value='';
  document.getElementById('rango-hasta').value='';
  goTo('sc-registro');
}

function renderTiposGrid(){
  const g=document.getElementById('tipos-grid'); g.innerHTML='';
  cfg.tipos.forEach(t=>{
    const d=document.createElement('div');
    d.className='tipo-btn';
    d.innerHTML=t.cod+'<small>'+t.desc+'</small>';
    d.onclick=()=>{tipoSel=t.cod;document.querySelectorAll('.tipo-btn').forEach(b=>b.classList.remove('sel'));d.classList.add('sel');};
    g.appendChild(d);
  });
}

async function doRegistro(){
  const err=document.getElementById('reg-err');
  if(!tipoSel){err.textContent='Selecciona el tipo de asistencia.';err.style.display='block';return;}
  err.style.display='none';
  const hoy=new Date().getDate();
  const dv=parseInt(document.getElementById('rango-desde').value);
  const hv=parseInt(document.getElementById('rango-hasta').value);
  const desde=isNaN(dv)?hoy:dv;
  const hasta=isNaN(hv)?desde:hv;
  if(desde>hasta){err.textContent='Desde no puede ser mayor que hasta.';err.style.display='block';return;}
  for(let d=desde;d<=hasta;d++){
    if(!registros[usuarioActual.nombre]) registros[usuarioActual.nombre]={};
    registros[usuarioActual.nombre][d]=tipoSel;
    await apiPost({ id: usuarioActual.nombre.replace(/[^a-zA-Z0-9]/g,'_')+'_'+d, nombre: usuarioActual.nombre, dia: d, tipo: tipoSel, mes: cfg.mes });
  }
  const rango=desde===hasta?'Dia '+desde:'Dias '+desde+' al '+hasta;
  document.getElementById('ok-info').innerHTML='<strong>'+usuarioActual.nombre+'</strong><br>'+rango+' - '+tipoSel+'<br>'+cfg.mes;
  goTo('sc-ok');
}

async function doAdminLogin(){
  const pass=document.getElementById('inp-admin-pass').value;
  const err=document.getElementById('admin-err');
  if(pass!==ADMIN_PASS){err.textContent='Contrasena incorrecta.';err.style.display='block';return;}
  err.style.display='none';
  document.getElementById('inp-admin-pass').value='';
  goTo('sc-admin');
  await cargarConfig();
  await cargarPersonal();
  await cargarRegistros();
  // Verificar si cambio el mes
  const mesActual = new Date().toLocaleString('es-AR', {month:'long', year:'numeric'}).toUpperCase();
  const mesCfg = cfg.mes.toUpperCase();
  if(!mesCfg.includes(new Date().toLocaleString('es-AR', {month:'long'}).toUpperCase())){
    setTimeout(()=>{
      if(confirm('Atencion: El mes configurado es "'+cfg.mes+'" pero estamos en '+mesActual+'. Queres actualizar el mes?')){
        goTo('sc-admin');
        switchTab('tab-config', document.querySelector('.tab'));
      }
    }, 500);
  }
  renderAll();
}

function switchTab(id,el){
  document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  ['tab-planilla','tab-personal','tab-rangos','tab-config','tab-export'].forEach(t=>{
    document.getElementById(t).style.display=t===id?'block':'none';
  });
  if(id==='tab-planilla') renderPlanilla();
  if(id==='tab-personal') renderPersonal();
  if(id==='tab-rangos') renderRangos();
  if(id==='tab-config') renderConfig();
}

function renderAll(){renderPlanilla();renderPersonal();renderRangos();renderConfig();}

function renderPlanilla(){
  const c=document.getElementById('planilla-container');
  if(!personal.length){c.innerHTML='<p style="font-size:13px;color:#64748b;padding:1rem 0;">Sin personal.</p>';return;}
  const inicio=parseInt(cfg.inicioSem)||0;
  let h='<table><thead><tr>';
  h+='<th class="col-fixed" style="min-width:110px;">Apellido y Nombre</th>';
  for(let d=1;d<=cfg.dias;d++){
    const semIdx=(inicio+d-1)%7;
    const ds=DIAS_SEM[semIdx];
    const esFinde=(semIdx===0||semIdx===6);
    h+='<th style="min-width:22px;'+(esFinde?'color:#ef4444;':'')+'">'+d+'<br><span style="font-size:9px;font-weight:400;">'+ds+'</span></th>';
  }
  h+='</tr></thead><tbody>';
  personal.forEach(p=>{
    h+='<tr>';
    h+='<td class="col-fixed" style="font-weight:600;">'+p.nombre+'</td>';
    for(let d=1;d<=cfg.dias;d++){
      const v=registros[p.nombre]&&registros[p.nombre][d]?registros[p.nombre][d]:'';
      const t=cfg.tipos.find(x=>x.cod===v);
      const col=t?t.color:'';
      const semIdx=(inicio+d-1)%7;
      const esFinde=(semIdx===0||semIdx===6);
      h+='<td style="color:'+col+';font-weight:'+(v?'700':'400')+';background:'+(esFinde?'#f8fafc':'')+';">'+v+'</td>';
    }
    h+='</tr>';
  });
  h+='</tbody></table>';
  c.innerHTML=h;
}

function renderPersonal(){
  const c=document.getElementById('lista-personal');
  if(!personal.length){c.innerHTML='<p style="font-size:13px;color:#64748b;">Sin personal.</p>';return;}
  c.innerHTML=personal.map((p,i)=>
    '<div class="row-between" style="flex-wrap:wrap;gap:4px;">'+
    '<div style="flex:1;min-width:0;">'+
    '<div style="font-size:13px;font-weight:600;">'+p.nombre+'</div>'+
    '<div style="font-size:11px;color:#64748b;">'+p.grado+' - L.P.: '+p.lp+'</div>'+
    '<div style="font-size:11px;margin-top:2px;">Pass: <span class="pass-chip">'+p.pass+'</span></div>'+
    '</div>'+
    '<div style="display:flex;gap:6px;align-items:center;margin-left:4px;">'+
    '<span style="cursor:pointer;font-size:16px;'+(i===0?'opacity:.3;pointer-events:none;':'')+'\" onclick="moverPersona('+i+',-1)">↑</span>'+
    '<span style="cursor:pointer;font-size:16px;'+(i===personal.length-1?'opacity:.3;pointer-events:none;':'')+'\" onclick="moverPersona('+i+',1)">↓</span>'+
    '<span style="cursor:pointer;color:#3b82f6;font-size:12px;" onclick="editarPersona('+i+')">Editar</span>'+
    '<span style="cursor:pointer;color:#ef4444;font-size:12px;" onclick="eliminarPersona('+i+')">Quitar</span>'+
    '</div></div>'
  ).join('');
}

async function agregarPersona(){
  const grado=document.getElementById('inp-grado').value.trim();
  const lp=document.getElementById('inp-lp').value.trim();
  const nombre=document.getElementById('inp-nombre').value.trim();
  const pass=document.getElementById('inp-new-pass').value.trim();
  if(!grado||!lp||!nombre||!pass){alert('Completa todos los campos.');return;}
  if(personal.find(p=>p.nombre===nombre)){alert('Ya existe esa persona.');return;}
  const id=nombre.replace(/[^a-zA-Z0-9]/g,'_');
  const orden=personal.length;
  await apiPost({id, grado, lp, nombre, pass, orden}, 'personal');
  personal.push({id, grado, lp, nombre, pass, orden});
  ['inp-grado','inp-lp','inp-nombre','inp-new-pass'].forEach(i=>document.getElementById(i).value='');
  renderPersonal(); renderPlanilla(); llenarPersonas('rango-persona'); llenarPersonas('celda-persona');
}


async function editarPersona(i){
  const p=personal[i];
  const nuevoNombre=prompt('Apellido y Nombre (actual: '+p.nombre+'):', p.nombre);
  if(nuevoNombre===null) return;
  const nuevoPass=prompt('Contrasena (actual: '+p.pass+'):', p.pass);
  if(nuevoPass===null) return;
  if(!nuevoNombre.trim()||!nuevoPass.trim()){alert('Ningun campo puede estar vacio.');return;}
  personal[i]={...personal[i], nombre:nuevoNombre.trim(), pass:nuevoPass.trim()};
  await apiPost({...personal[i]}, 'personal');
  renderPersonal();
  renderPlanilla();
}

async function moverPersona(i, dir){
  const j = i + dir;
  if(j<0||j>=personal.length) return;
  [personal[i], personal[j]] = [personal[j], personal[i]];
  personal[i].orden = i;
  personal[j].orden = j;
  await apiPost({...personal[i]}, 'personal');
  await apiPost({...personal[j]}, 'personal');
  renderPersonal();
  renderPlanilla();
}

async function eliminarPersona(i){
  if(!confirm('Quitar a '+personal[i].nombre+'?')) return;
  await apiDelete({id: personal[i].id}, 'personal');
  personal.splice(i,1);
  renderPersonal(); renderPlanilla();
}

function renderRangos(){
  llenarPersonas('rango-persona'); llenarPersonas('celda-persona');
  llenarTipos('rango-admin-tipo'); llenarTipos('celda-tipo');
}

async function aplicarRangoAdmin(){
  const persona=document.getElementById('rango-persona').value;
  const desde=parseInt(document.getElementById('rango-admin-desde').value);
  const hasta=parseInt(document.getElementById('rango-admin-hasta').value);
  const tipo=document.getElementById('rango-admin-tipo').value;
  if(!persona||!tipo||isNaN(desde)||isNaN(hasta)){alert('Completa todos los campos.');return;}
  if(desde>hasta){alert('Desde no puede ser mayor que hasta.');return;}
  for(let d=desde;d<=hasta;d++){
    if(!registros[persona]) registros[persona]={};
    registros[persona][d]=tipo;
    await apiPost({ id: persona.replace(/[^a-zA-Z0-9]/g,'_')+'_'+d, nombre: persona, dia: d, tipo, mes: cfg.mes });
  }
  alert('Aplicado: '+persona+', dias '+desde+' al '+hasta+' - '+tipo);
  renderPlanilla();
}

async function editarCelda(){
  const persona=document.getElementById('celda-persona').value;
  const dia=parseInt(document.getElementById('celda-dia').value);
  const tipo=document.getElementById('celda-tipo').value;
  if(!persona||isNaN(dia)||!tipo){alert('Completa todos los campos.');return;}
  if(!registros[persona]) registros[persona]={};
  registros[persona][dia]=tipo;
  await apiPost({ id: persona.replace(/[^a-zA-Z0-9]/g,'_')+'_'+dia, nombre: persona, dia, tipo, mes: cfg.mes });
  alert('Celda actualizada.');
  renderPlanilla();
}

function renderConfig(){
  document.getElementById('cfg-mes').value=cfg.mes;
  document.getElementById('cfg-dias').value=cfg.dias;
  document.getElementById('cfg-inicio').value=cfg.inicioSem||0;
  const lt=document.getElementById('lista-tipos');
  lt.innerHTML=cfg.tipos.map((t,i)=>
    '<div class="row-between">'+
    '<span style="font-size:13px;"><span class="dot" style="background:'+t.color+';"></span><strong>'+t.cod+'</strong> - '+t.desc+'</span>'+
    '<span style="cursor:pointer;color:#ef4444;font-size:12px;" onclick="eliminarTipo('+i+')">Quitar</span>'+
    '</div>'
  ).join('');
}

async function guardarConfigMes(){
  cfg.mes=document.getElementById('cfg-mes').value.trim()||cfg.mes;
  cfg.dias=parseInt(document.getElementById('cfg-dias').value)||30;
  cfg.inicioSem=parseInt(document.getElementById('cfg-inicio').value)||0;
  svLocal('cfg');
  await apiPost({id:'configuracion', mes:cfg.mes, dias:cfg.dias, inicioSem:cfg.inicioSem, tipos:cfg.tipos}, 'config');
  alert('Configuracion guardada para todos.');
  renderPlanilla();
}

async function agregarTipo(){
  const cod=document.getElementById('cfg-tipo-cod').value.trim().toUpperCase();
  const desc=document.getElementById('cfg-tipo-desc').value.trim();
  const color=document.getElementById('cfg-tipo-color').value;
  if(!cod||!desc){alert('Completa codigo y descripcion.');return;}
  if(cfg.tipos.find(t=>t.cod===cod)){alert('Ese codigo ya existe.');return;}
  cfg.tipos.push({cod,desc,color}); svLocal('cfg');
  document.getElementById('cfg-tipo-cod').value='';
  document.getElementById('cfg-tipo-desc').value='';
  await apiPost({id:'configuracion', mes:cfg.mes, dias:cfg.dias, inicioSem:cfg.inicioSem, tipos:cfg.tipos}, 'config');
  renderConfig();
}

async function eliminarTipo(i){
  if(!confirm('Quitar el tipo "'+cfg.tipos[i].cod+'"?')) return;
  cfg.tipos.splice(i,1); svLocal('cfg');
  await apiPost({id:'configuracion', mes:cfg.mes, dias:cfg.dias, inicioSem:cfg.inicioSem, tipos:cfg.tipos}, 'config');
  renderConfig();
}

function exportarCSV(){
  let csv='Apellido y Nombre';
  for(let d=1;d<=cfg.dias;d++) csv+=','+d;
  csv+='\n';
  personal.forEach(p=>{
    csv+='"'+p.nombre+'"';
    for(let d=1;d<=cfg.dias;d++) csv+=','+(registros[p.nombre]&&registros[p.nombre][d]?registros[p.nombre][d]:'');
    csv+='\n';
  });
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='Guardias_'+cfg.mes.replace(/ /g,'_')+'.csv';
  a.click();
}

async function reiniciarMes(){
  if(!confirm('Reiniciar todos los registros del mes? Los datos se archivaran antes de borrarse.')) return;
  
  // Archivar mes actual
  const mesArchivo = {
    id: cfg.mes.replace(/ /g,'_')+'_'+Date.now(),
    mes: cfg.mes,
    fecha: new Date().toISOString(),
    registros: registros,
    personal: personal.map(p=>({nombre:p.nombre, grado:p.grado, lp:p.lp}))
  };
  await apiPost(mesArchivo, 'archivo');
  
  // Limpiar registros en Azure
  await apiPost({}, 'limpiar');
  
  registros = {};
  alert('Mes archivado y reiniciado correctamente.');
  renderPlanilla();
}

goTo('sc-home');
