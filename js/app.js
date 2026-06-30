const API_URL =
    'https://guardias-api-dzatbfhae4hyhpeq.centralus-01.azurewebsites.net/api/guardias-api';
    const API_KEY = atob('Z0sxbU4ycFE4d1I0eFQ1dlk5ekFiMEM2ZEUxZkgwakw=');

    async function registrarAuditoria(accion, detalle, usuario) {
    const ahora = new Date();
    const fecha = ahora.toISOString().slice(0, 10); // YYYY-MM-DD
    const log = {
        id: crypto.randomUUID(),
        fecha: fecha,
        timestamp: ahora.toISOString(),
        accion: accion,
        detalle: detalle,
        usuario: usuario || 'desconocido'
    };
    try {
        await apiPost(log, 'auditoria');
    } catch (e) {
        console.error('Error registrando auditoria:', e);
    }
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password.trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const ADMIN_PASS_HASH_DEFAULT = '059a50ce956b7ec61527c7ecc0c55b5a009dc54ab4acddce8852b46baa2aba30';
let ADMIN_PASS_HASH_GLOBAL = ADMIN_PASS_HASH_DEFAULT;
const CONSULTA_PASS_HASH = '8123c283e4d6fb72777fa21f3442fb90eb9f2d5c894c8802e6e280af8e297436';
let modoConsulta=false;
const DIAS_SEM = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

let cfg = JSON.parse(localStorage.getItem('grd_cfg') || 'null') || {
    mes: 'ABRIL 2026',
    dias: 30,
    inicioSem: 1,
    tipos: [
        { cod: 'G', desc: 'Guardia', color: '#10b981' },
        { cod: 'M/T', desc: 'Manana y Tarde', color: '#3b82f6' },
        { cod: '12HS', desc: '12 horas', color: '#f59e0b' },
        { cod: 'L/O', desc: 'Licencia Ord.', color: '#8b5cf6' },
        { cod: 'L/M', desc: 'Licencia Med.', color: '#ef4444' },
        { cod: 'L/F', desc: 'Lic. Fallecimiento', color: '#ec4899' },
        { cod: 'L/E', desc: 'Lic. Estudios', color: '#6b7280' },
    ],
};
let personal = [];
let registros = {};
let turnos = [];
let usuarioActual = null;
let tipoSel = null;

// Rate limiting client-side
const rateLimiter = { calls: {}, limit: 100, window: 60000 };
function checkRateLimit(key) {
    const now = Date.now();
    if (!rateLimiter.calls[key]) rateLimiter.calls[key] = [];
    rateLimiter.calls[key] = rateLimiter.calls[key].filter(
        (t) => now - t < rateLimiter.window,
    );
    if (rateLimiter.calls[key].length >= rateLimiter.limit) return false;
    rateLimiter.calls[key].push(now);
    return true;
}

// Input sanitization
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/[<>\"'&]/g, '')
        .trim()
        .slice(0, 200);
}

function svLocal(k) {
    if (k === 'cfg') localStorage.setItem('grd_cfg', JSON.stringify(cfg));
}

async function apiGet(tipo) {
    try {
        const url = tipo
            ? API_URL + '?tipo=' + encodeURIComponent(tipo)
            : API_URL;
        const r = await fetch(url, {
            headers: { 'X-API-Key': API_KEY },
            signal: AbortSignal.timeout(30000)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
    } catch (e) {
        console.error('Error en la solicitud');
        return [];
    }
}

async function apiPost(data, tipo) {
    if (!checkRateLimit('post')) {
        alert('Demasiadas solicitudes. Espera un momento.');
        return;
    }
    try {
        const url = tipo
            ? API_URL + '?tipo=' + encodeURIComponent(tipo)
            : API_URL;
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
        console.error('Error en la solicitud');
    }
}

async function apiDelete(data, tipo) {
    try {
        const url = tipo
            ? API_URL + '?tipo=' + encodeURIComponent(tipo)
            : API_URL;
        const r = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY
            },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
        console.error('Error en la solicitud');
    }
}

async function cargarPersonal() {
    const data = await apiGet('personal');
    personal = data.filter((d) => d.nombre);
    personal.sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

async function cargarConfig() {
    const data = await apiGet('config');
    const cfgAzure = data.find((d) => d.id === 'configuracion');
    if (cfgAzure && cfgAzure.tipos) cfg.tipos = cfgAzure.tipos;
    if (cfgAzure && cfgAzure.mes) cfg.mes = cfgAzure.mes;
    if (cfgAzure && cfgAzure.dias) cfg.dias = cfgAzure.dias;
    if (cfgAzure && cfgAzure.inicioSem !== undefined)
        cfg.inicioSem = cfgAzure.inicioSem;
    
    // Cargar hash de pass admin desde Cosmos (global)
    const adminPassDoc = data.find((d) => d.id === 'admin_pass');
    if (adminPassDoc && adminPassDoc.hash) {
        ADMIN_PASS_HASH_GLOBAL = adminPassDoc.hash;
    }
}

async function cargarRegistros() {
    const data = await apiGet();
    registros = {};
    data.forEach((d) => {
        if (d.nombre && d.dia && d.tipo) {
            if (!registros[d.nombre]) registros[d.nombre] = {};
            registros[d.nombre][d.dia] = d.tipo;
        }
    });
}

function togglePass(id, btn) {
    const inp = document.getElementById(id);
    if (inp.type === 'password') {
        inp.type = 'text';
        btn.style.color = '#3b82f6';
    } else {
        inp.type = 'password';
        btn.style.color = '#94a3b8';
    }
}

function goTo(id) {
    document
        .querySelectorAll('.screen')
        .forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    tipoSel = null;
    document
        .querySelectorAll('.tipo-btn')
        .forEach((b) => b.classList.remove('sel'));
    document.getElementById('home-mes').textContent = cfg.mes;
}

async function iniciarLogin() {

    // Bloqueo de mantenimiento hasta el 1 de julio
    const ahora = new Date();
    const finMantenimiento = new Date('2026-07-01T00:00:00');
    if (ahora < finMantenimiento) {
        alert('🛠️ Sistema en mantenimiento\n\nLa carga de asistencia estará disponible a partir del 1 de Julio de 2026.\n\n El presente sera cargado manualmente por Administración');
        return;
    }

    goTo('sc-login');
    document.getElementById('login-loader').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    await cargarConfig();
    await cargarPersonal();
    document.getElementById('login-loader').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
}

function llenarSel(id, arr, vFn, lFn, empty) {
    const s = document.getElementById(id);
    if (!s) return;
    s.innerHTML = '<option value="">' + (empty || 'Selecciona') + '</option>';
    arr.forEach((x, i) => {
        const o = document.createElement('option');
        o.value = vFn(x, i);
        o.textContent = lFn(x, i);
        s.appendChild(o);
    });
}
function llenarPersonas(id) {
    llenarSel(
        id,
        personal,
        (p) => p.nombre,
        (p) => p.nombre,
    );
}
function llenarTipos(id) {
    llenarSel(
        id,
        cfg.tipos,
        (t) => t.cod,
        (t) => t.cod + ' - ' + t.desc,
    );
}
function llenarNombresLogin() {
    llenarSel(
        'sel-nombre',
        personal,
        (_, i) => i,
        (p) => p.nombre,
        'Tu nombre',
    );
}

// Login con proteccion de intentos fallidos
const BLOQUEO_MINUTOS = 20;
const BLOQUEO_MS = BLOQUEO_MINUTOS * 60 * 1000;
const MAX_INTENTOS = 5;

function getBloqueo(key) {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (!data) return { count: 0, blocked: false };
    if (data.blocked && Date.now() > data.until) {
        localStorage.removeItem(key);
        return { count: 0, blocked: false };
    }
    return data;
}

function setBloqueo(key, count, blocked) {
    localStorage.setItem(
        key,
        JSON.stringify({
            count,
            blocked,
            until: blocked ? Date.now() + BLOQUEO_MS : 0,
        }),
    );
}

async function doLogin() {
    const bl = getBloqueo('login_block');
    if (bl.blocked) {
        const restante = Math.ceil(
            (JSON.parse(localStorage.getItem('login_block')).until -
                Date.now()) /
                60000,
        );
        alert(
            'Demasiados intentos fallidos. Espera ' + restante + ' minuto(s).',
        );
        return;
    }

    const usuario = document.getElementById('inp-usuario-login').value.trim().toLowerCase();
    const pass = document.getElementById('inp-pass').value;
    const err = document.getElementById('login-err');
    if (!usuario) {
        err.textContent = 'Ingresa tu usuario.';
        err.style.display = 'block';
        return;
    }
    if (!pass) {
        err.textContent = 'Ingresa tu contraseña.';
        err.style.display = 'block';
        return;
    }
    const p = personal.find((per) => per.usuario === usuario);
    if (!p) {
        const nuevoCount = bl.count + 1;
        const bloqueado = nuevoCount >= MAX_INTENTOS;
        setBloqueo('login_block', nuevoCount, bloqueado);
        err.textContent = bloqueado
            ? 'Cuenta bloqueada por ' + BLOQUEO_MINUTOS + ' minutos.'
            : 'Usuario o contraseña incorrectos. Intento ' + nuevoCount + '/' + MAX_INTENTOS + '.';
        err.style.display = 'block';
        return;
    }
    const passHash = await hashPassword(pass);
    if (p.pass !== passHash) {
        const nuevoCount = bl.count + 1;
        const bloqueado = nuevoCount >= MAX_INTENTOS;
        setBloqueo('login_block', nuevoCount, bloqueado);
        err.textContent = bloqueado
            ? 'Cuenta bloqueada por ' + BLOQUEO_MINUTOS + ' minutos.'
            : 'Usuario o contraseña incorrectos. Intento ' + nuevoCount + '/' + MAX_INTENTOS + '.';
        err.style.display = 'block';
        return;
    }
    localStorage.removeItem('login_block');
    err.style.display = 'none';
    document.getElementById('inp-usuario-login').value = '';
    document.getElementById('inp-pass').value = '';
    usuarioActual = { ...p };
    const dia = new Date().getDate();
    const yaReg = registros[p.nombre] && registros[p.nombre][dia];
    document.getElementById('reg-title').textContent =
        'Hola, ' + p.nombre.split(',')[0];
    document.getElementById('reg-info').innerHTML = yaReg
        ? '<div class="alert alert-ok">Ya registraste <strong translate="no">' +
          yaReg +
          '</strong> hoy, dia ' +
          dia +
          '.</div>'
        : '<div style="font-size:13px;color:#64748b;">Hoy es el dia <strong>' +
          dia +
          '</strong> de ' +
          cfg.mes +
          '</div>';
    renderTiposGrid();
    document.getElementById('rango-desde').value = '';
    document.getElementById('rango-hasta').value = '';
    goTo('sc-registro');
}

function renderTiposGrid() {
    const g = document.getElementById('tipos-grid');
    g.innerHTML = '';
    cfg.tipos.forEach((t) => {
        const d = document.createElement('div');
        d.className = 'tipo-btn';
        d.setAttribute('translate', 'no');
        d.innerHTML =
            '<span translate="no">' +
            t.cod +
            '</span><small translate="no">' +
            t.desc +
            '</small>';
        d.onclick = () => {
            tipoSel = t.cod;
            document
                .querySelectorAll('.tipo-btn')
                .forEach((b) => b.classList.remove('sel'));
            d.classList.add('sel');
        };
        g.appendChild(d);
    });
}

async function doRegistro() {
    const err = document.getElementById('reg-err');
    if (!tipoSel) {
        err.textContent = 'Selecciona el tipo de asistencia.';
        err.style.display = 'block';
        return;
    }
    err.style.display = 'none';
    const hoy = new Date().getDate();
    const dv = parseInt(document.getElementById('rango-desde').value);
    const hv = parseInt(document.getElementById('rango-hasta').value);
    const desde = isNaN(dv) ? hoy : dv;
    const hasta = isNaN(hv) ? desde : hv;
    if (desde > hasta) {
        err.textContent = 'Desde no puede ser mayor que hasta.';
        err.style.display = 'block';
        return;
    }
    if (hasta - desde > 30) {
        err.textContent = 'El rango no puede ser mayor a 31 dias.';
        err.style.display = 'block';
        return;
    }
    for (let d = desde; d <= hasta; d++) {
        if (!registros[usuarioActual.nombre])
            registros[usuarioActual.nombre] = {};
        registros[usuarioActual.nombre][d] = tipoSel;
        await apiPost({
            id: usuarioActual.nombre.replace(/[^a-zA-Z0-9]/g, '_') + '_' + d,
            nombre: usuarioActual.nombre,
            dia: d,
            tipo: tipoSel,
            mes: cfg.mes,
        });
    }
    const rango =
        desde === hasta ? 'Dia ' + desde : 'Dias ' + desde + ' al ' + hasta;
    document.getElementById('ok-info').innerHTML =
        '<strong>' +
        usuarioActual.nombre +
        '</strong><br>' +
        rango +
        ' &rarr; <span translate="no">' +
        tipoSel +
        '</span><br><span style="font-size:12px;">' +
        cfg.mes +
        '</span>';
    goTo('sc-ok');
}

async function doAdminLogin() {
    const bl = getBloqueo('admin_block');
    if (bl.blocked) {
        const restante = Math.ceil(
            (JSON.parse(localStorage.getItem('admin_block')).until -
                Date.now()) /
                60000,
        );
        alert('Demasiados intentos. Espera ' + restante + ' minuto(s).');
        return;
    }

   const pass = document.getElementById('inp-admin-pass').value;
    const err = document.getElementById('admin-err');
    await cargarConfig();
    const passHash = await hashPassword(pass);
    const esAdmin = passHash === ADMIN_PASS_HASH_GLOBAL;
    const esConsulta = passHash === CONSULTA_PASS_HASH;
    if (!esAdmin && !esConsulta) {
        const nuevoCount = bl.count + 1;
        registrarAuditoria('LOGIN_ADMIN_FALLIDO', 'Intento ' + nuevoCount + '/' + MAX_INTENTOS, 'desconocido');
        const bloqueado = nuevoCount >= MAX_INTENTOS;
        setBloqueo('admin_block', nuevoCount, bloqueado);
        err.textContent = bloqueado
            ? 'Cuenta bloqueada por ' + BLOQUEO_MINUTOS + ' minutos.'
            : 'Contraseña incorrecta. Intento ' +
              nuevoCount +
              '/' +
              MAX_INTENTOS +
              '.';
        err.style.display = 'block';
        return;
    }
    localStorage.removeItem('admin_block');
    err.style.display = 'none';
    document.getElementById('inp-admin-pass').value = '';
    goTo('sc-admin');
    
    registrarAuditoria(esConsulta ? 'LOGIN_CONSULTA' : 'LOGIN_ADMIN', 'Acceso exitoso', esConsulta ? 'consulta' : 'admin');

      modoConsulta = esConsulta;
    const tabs = document.querySelectorAll('.tabs .tab');
    tabs.forEach((tab, i) => {
        tab.style.display = modoConsulta && i > 0 ? 'none' : '';
    });

    await cargarConfig();
    await cargarPersonal();
    await cargarRegistros();
    await cargarTurnos();
    const mesActual = new Date()
        .toLocaleString('es-AR', { month: 'long', year: 'numeric' })
        .toUpperCase();
    if (
        !cfg.mes
            .toUpperCase()
            .includes(
                new Date()
                    .toLocaleString('es-AR', { month: 'long' })
                    .toUpperCase(),
            )
    ) {
        setTimeout(() => {
            if (
                confirm(
                    'Atencion: El mes configurado es "' +
                        cfg.mes +
                        '" pero estamos en ' +
                        mesActual +
                        '. Queres actualizar el mes?',
                )
            ) {
                switchTab('tab-config', document.querySelectorAll('.tab')[3]);
            }
        }, 500);
    }
    renderAll();
}

function switchTab(id, el) {
    document
        .querySelectorAll('.tabs .tab')
        .forEach((t) => t.classList.remove('active'));
    if (el) el.classList.add('active');
    [
        'tab-planilla',
        'tab-personal',
        'tab-rangos',
        'tab-config',
        'tab-turnos',
        'tab-export',
        'tab-historial',
        'tab-auditoria'
    ].forEach((t) => {
        document.getElementById(t).style.display = t === id ? 'block' : 'none';
    });
    if (id === 'tab-planilla') renderPlanilla();
    if (id === 'tab-personal') renderPersonal();
    if (id === 'tab-rangos') renderRangos();
    if (id === 'tab-config') renderConfig();
    if (id === 'tab-turnos') renderTurnos();
    if (id === 'tab-historial') renderHistorial();
    if (id === 'tab-auditoria') renderAuditoria();
}

function renderAll() {
    renderPlanilla();
    renderPersonal();
    renderRangos();
    renderConfig();
    renderTurnos();
}

function renderPlanilla() {
    const c = document.getElementById('planilla-container');
    if (!personal.length) {
        c.innerHTML =
            '<p style="font-size:13px;color:#64748b;padding:1rem;">Sin personal registrado.</p>';
        return;
    }
    const inicio = parseInt(cfg.inicioSem) || 0;
    let h = '<table><thead><tr><th class="col-fixed">Apellido y Nombre</th>';
    for (let d = 1; d <= cfg.dias; d++) {
        const semIdx = (inicio + d - 1) % 7;
        const ds = DIAS_SEM[semIdx];
        const esFinde = semIdx === 0 || semIdx === 6;
        h +=
            '<th style="min-width:24px;' +
            (esFinde ? 'color:#ef4444;background:#fff5f5;' : '') +
            '">' +
            d +
            '<br><span style="font-size:9px;font-weight:400;">' +
            ds +
            '</span></th>';
    }
    h += '</tr></thead><tbody>';
    personal.forEach((p) => {
        h += '<tr><td class="col-fixed">' + p.nombre + '</td>';
        for (let d = 1; d <= cfg.dias; d++) {
            const v =
                registros[p.nombre] && registros[p.nombre][d]
                    ? registros[p.nombre][d]
                    : '';
            const t = cfg.tipos.find((x) => x.cod === v);
            const col = t ? t.color : '';
            const semIdx = (inicio + d - 1) % 7;
            const esFinde = semIdx === 0 || semIdx === 6;
            h +=
                '<td style="color:' +
                col +
                ';font-weight:' +
                (v ? '700' : '400') +
                ';background:' +
                (esFinde ? '#fff5f5' : '') +
                ';"><span translate="no">' +
                v +
                '</span></td>';
        }
        h += '</tr>';
    });
    h += '</tbody></table>';
    c.innerHTML = h;
}

function renderPersonal() {
    const c = document.getElementById('lista-personal');
    if (!personal.length) {
        c.innerHTML =
            '<p style="font-size:13px;color:#64748b;">Sin personal.</p>';
        return;
    }
    c.innerHTML = personal
        .map(
            (p, i) =>
                '<div class="row-between">' +
                '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                p.nombre +
                '</div>' +
                '<div style="font-size:11px;color:#64748b;">' +
                p.grado +
                ' · L.P.: ' +
                p.lp +
                '</div>' +
                '<div style="font-size:11px;color:#3b82f6;margin-top:2px;">👤 Usuario: <strong translate="no">' +
                (p.usuario || 'sin asignar') +
                '</strong></div>' +
                '<div style="font-size:11px;margin-top:2px;color:#10b981;">🔒 Contraseña cifrada</div>' +
                '</div>' +
                '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">' +
                '<span style="cursor:pointer;font-size:18px;' +
                (i === 0 ? 'opacity:.25;pointer-events:none;' : '') +
                '" onclick="moverPersona(' +
                i +
                ',-1)">↑</span>' +
                '<span style="cursor:pointer;font-size:18px;' +
                (i === personal.length - 1
                    ? 'opacity:.25;pointer-events:none;'
                    : '') +
                '" onclick="moverPersona(' +
                i +
                ',1)">↓</span>' +
                '<span style="cursor:pointer;color:#3b82f6;font-size:12px;font-weight:600;" onclick="editarPersona(' +
                i +
                ')">Editar</span>' +
                '<span style="cursor:pointer;color:#ef4444;font-size:12px;font-weight:600;" onclick="eliminarPersona(' +
                i +
                ')">Quitar</span>' +
                '</div></div>',
        )
        .join('');
}

async function agregarPersona() {
    const grado = sanitize(document.getElementById('inp-grado').value);
    const lp = sanitize(document.getElementById('inp-lp').value);
    const nombre = sanitize(document.getElementById('inp-nombre').value);
    const usuario = sanitize(document.getElementById('inp-usuario').value).toLowerCase();
    const pass = sanitize(document.getElementById('inp-new-pass').value);
    if (!grado || !lp || !nombre || !usuario || !pass) {
        alert('Completa todos los campos.');
        return;
    }
    if (usuario.length < 3) {
        alert('El usuario debe tener al menos 3 caracteres.');
        return;
    }
    if (!/^[a-z0-9._]+$/.test(usuario)) {
        alert('El usuario solo puede tener letras minúsculas, numeros, puntos y guiones bajos.');
        return;
    }
    if (pass.length < 4) {
        alert('La contraseña debe tener al menos 4 caracteres.');
        return;
    }
    if (personal.find((p) => p.nombre === nombre)) {
        alert('Ya existe esa persona.');
        return;
    }
    if (personal.find((p) => p.usuario === usuario)) {
        alert('Ese usuario ya existe. Elegí otro.');
        return;
    }
    const id = nombre.replace(/[^a-zA-Z0-9]/g, '_');
    const orden = personal.length;
    const passHash = await hashPassword(pass);
    await apiPost({ id, grado, lp, nombre, usuario, pass: passHash, orden }, 'personal');
    personal.push({ id, grado, lp, nombre, usuario, pass: passHash, orden });
    ['inp-grado', 'inp-lp', 'inp-nombre', 'inp-usuario', 'inp-new-pass'].forEach(
        (i) => (document.getElementById(i).value = ''),
    );
    registrarAuditoria('PERSONAL_CREAR', 'Agregar: ' + nombre + ' (LP: ' + lp + ', usuario: ' + usuario + ')', 'admin');
    renderPersonal();
    renderPlanilla();
    llenarPersonas('rango-persona');
    llenarPersonas('celda-persona');
}

async function editarPersona(i) {
    const p = personal[i];
    const nuevoNombre = prompt('Apellido y Nombre (actual: ' + p.nombre + '):', p.nombre);
    if (nuevoNombre === null) return;
    const nuevoUsuario = prompt('Usuario (actual: ' + (p.usuario || 'sin usuario') + '):', p.usuario || '');
    if (nuevoUsuario === null) return;
    const nuevoPass = prompt('Nueva contraseña (dejar vacío para no cambiar):', '');
    if (nuevoPass === null) return;
    if (!nuevoNombre.trim()) {
        alert('El nombre no puede estar vacío.');
        return;
    }
    const usuarioFinal = nuevoUsuario.trim().toLowerCase();
    if (!usuarioFinal) {
        alert('El usuario no puede estar vacío.');
        return;
    }
    if (usuarioFinal.length < 3) {
        alert('El usuario debe tener al menos 3 caracteres.');
        return;
    }
    if (!/^[a-z0-9._]+$/.test(usuarioFinal)) {
        alert('El usuario solo puede tener letras minúsculas, numeros, puntos y guiones bajos.');
        return;
    }
    if (personal.find((per, idx) => per.usuario === usuarioFinal && idx !== i)) {
        alert('Ese usuario ya está en uso por otra persona.');
        return;
    }
    let passFinal = personal[i].pass;
    if (nuevoPass.trim()) {
        if (nuevoPass.trim().length < 4) {
            alert('La contraseña debe tener al menos 4 caracteres.');
            return;
        }
        passFinal = await hashPassword(nuevoPass.trim());
    }
    personal[i] = {
        ...personal[i],
        nombre: sanitize(nuevoNombre),
        usuario: usuarioFinal,
        pass: passFinal,
    };
    await apiPost({ ...personal[i] }, 'personal');
    registrarAuditoria('PERSONAL_EDITAR', 'Editado: ' + p.nombre + ' (usuario: ' + usuarioFinal + (nuevoPass.trim() ? ', con cambio de pass' : '') + ')', 'admin');
    renderPersonal();
    renderPlanilla();
}
async function moverPersona(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= personal.length) return;
    [personal[i], personal[j]] = [personal[j], personal[i]];
    personal[i].orden = i;
    personal[j].orden = j;
    await apiPost({ ...personal[i] }, 'personal');
    await apiPost({ ...personal[j] }, 'personal');
    renderPersonal();
    renderPlanilla();
}

async function eliminarPersona(i) {
    if (!confirm('Quitar a ' + personal[i].nombre + '?')) return;
    await apiDelete({ id: personal[i].id }, 'personal');
    registrarAuditoria('PERSONAL_ELIMINAR', 'Eliminado: ' + personal[i].nombre, 'admin');
    personal.splice(i, 1);
    renderPersonal();
    renderPlanilla();
}

function renderRangos() {
    llenarPersonas('rango-persona');
    llenarPersonas('celda-persona');
    llenarTipos('rango-admin-tipo');
    llenarTipos('celda-tipo');
}

async function aplicarRangoAdmin() {
    const persona = document.getElementById('rango-persona').value;
    const desde = parseInt(document.getElementById('rango-admin-desde').value);
    const hasta = parseInt(document.getElementById('rango-admin-hasta').value);
    const tipo = document.getElementById('rango-admin-tipo').value;
    if (!persona || !tipo || isNaN(desde) || isNaN(hasta)) {
        alert('Completa todos los campos.');
        return;
    }
    if (desde > hasta) {
        alert('Desde no puede ser mayor que hasta.');
        return;
    }
    for (let d = desde; d <= hasta; d++) {
        if (!registros[persona]) registros[persona] = {};
        registros[persona][d] = tipo;
        await apiPost({
            id: persona.replace(/[^a-zA-Z0-9]/g, '_') + '_' + d,
            nombre: persona,
            dia: d,
            tipo,
            mes: cfg.mes,
        });
    }
    await registrarAuditoria('RANGO_APLICAR', persona + ' - dias ' + desde + ' al ' + hasta + ' → ' + tipo, 'admin');
    alert(
        'Aplicado: ' +
            persona +
            ', dias ' +
            desde +
            ' al ' +
            hasta +
            ' → ' +
            tipo,
    );
    await cargarRegistros();
    renderPlanilla();
}

async function editarCelda() {
    const persona = document.getElementById('celda-persona').value;
    const dia = parseInt(document.getElementById('celda-dia').value);
    const tipo = document.getElementById('celda-tipo').value;
    if (!persona || isNaN(dia)) {
        alert('Selecciona persona y dia.');
        return;
    }
    if (!tipo) {
        if (
            !confirm(
                'Borrar el registro de ' + persona + ' del dia ' + dia + '?',
            )
        )
            return;
        if (registros[persona]) delete registros[persona][dia];
        await apiDelete(
            {
                id: persona.replace(/[^a-zA-Z0-9]/g, '_') + '_' + dia,
                nombre: persona,
            },
            'registro',
        );
        registrarAuditoria('CELDA_BORRAR', persona + ' - dia ' + dia, 'admin');
        alert('Registro borrado.');
        renderPlanilla();
        return;
    }
    if (!registros[persona]) registros[persona] = {};
    registros[persona][dia] = tipo;
    await apiPost({
        id: persona.replace(/[^a-zA-Z0-9]/g, '_') + '_' + dia,
        nombre: persona,
        dia,
        tipo,
        mes: cfg.mes,
    });
    registrarAuditoria('CELDA_EDITAR', persona + ' - dia ' + dia + ' → ' + tipo, 'admin');
    alert('Celda actualizada.');
    renderPlanilla();
}

function renderConfig() {
    document.getElementById('cfg-mes').value = cfg.mes;
    document.getElementById('cfg-dias').value = cfg.dias;
    document.getElementById('cfg-inicio').value = cfg.inicioSem || 0;
    const lt = document.getElementById('lista-tipos');
    lt.innerHTML = cfg.tipos
        .map(
            (t, i) =>
                '<div class="row-between">' +
                '<span style="font-size:13px;display:flex;align-items:center;"><span class="dot" style="background:' +
                t.color +
                '"></span><strong translate="no">' +
                t.cod +
                '</strong>&nbsp;–&nbsp;<span translate="no">' +
                t.desc +
                '</span></span>' +
                '<span style="cursor:pointer;color:#ef4444;font-size:12px;font-weight:600;" onclick="eliminarTipo(' +
                i +
                ')">Quitar</span>' +
                '</div>',
        )
        .join('');
}

async function guardarConfigMes() {
    cfg.mes = sanitize(document.getElementById('cfg-mes').value) || cfg.mes;
    cfg.dias = parseInt(document.getElementById('cfg-dias').value) || 30;
    cfg.inicioSem = parseInt(document.getElementById('cfg-inicio').value) || 0;
    svLocal('cfg');
    await apiPost(
        {
            id: 'configuracion',
            mes: cfg.mes,
            dias: cfg.dias,
            inicioSem: cfg.inicioSem,
            tipos: cfg.tipos,
        },
        'config',
    );
    alert('Configuracion guardada para todos.');
    renderPlanilla();
}

async function agregarTipo() {
    const cod = sanitize(
        document.getElementById('cfg-tipo-cod').value,
    ).toUpperCase();
    const desc = sanitize(document.getElementById('cfg-tipo-desc').value);
    const color = document.getElementById('cfg-tipo-color').value;
    if (!cod || !desc) {
        alert('Completa codigo y descripcion.');
        return;
    }
    if (cfg.tipos.find((t) => t.cod === cod)) {
        alert('Ese codigo ya existe.');
        return;
    }
    cfg.tipos.push({ cod, desc, color });
    svLocal('cfg');
    document.getElementById('cfg-tipo-cod').value = '';
    document.getElementById('cfg-tipo-desc').value = '';
    await apiPost(
        {
            id: 'configuracion',
            mes: cfg.mes,
            dias: cfg.dias,
            inicioSem: cfg.inicioSem,
            tipos: cfg.tipos,
        },
        'config',
    );
    renderConfig();
}

async function eliminarTipo(i) {
    if (!confirm('Quitar el tipo "' + cfg.tipos[i].cod + '"?')) return;
    cfg.tipos.splice(i, 1);
    svLocal('cfg');
    await apiPost(
        {
            id: 'configuracion',
            mes: cfg.mes,
            dias: cfg.dias,
            inicioSem: cfg.inicioSem,
            tipos: cfg.tipos,
        },
        'config',
    );
    renderConfig();
}

function exportarCSV() {
    const inicio = parseInt(cfg.inicioSem) || 0;
    const datos = [];
    
    // Encabezados
    const header = ['Apellido y Nombre'];
    for (let d = 1; d <= cfg.dias; d++) {
        const semIdx = (inicio + d - 1) % 7;
        header.push(d + ' (' + DIAS_SEM[semIdx] + ')');
    }
    datos.push(header);
    
    // Filas de personal
    personal.forEach((p) => {
        const fila = [p.nombre];
        for (let d = 1; d <= cfg.dias; d++) {
            fila.push(registros[p.nombre] && registros[p.nombre][d] ? registros[p.nombre][d] : '');
        }
        datos.push(fila);
    });
    
    // Crear hoja
    const ws = XLSX.utils.aoa_to_sheet(datos);
    
    // Anchos de columna
    ws['!cols'] = [{wch: 30}];
    for (let d = 1; d <= cfg.dias; d++) ws['!cols'].push({wch: 7});
    
    // Aplicar colores y estilos
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const cellAddr = XLSX.utils.encode_cell({r: R, c: C});
            if (!ws[cellAddr]) continue;
            
            // Encabezado
            if (R === 0) {
                ws[cellAddr].s = {
                    font: {bold: true, color: {rgb: 'FFFFFF'}},
                    fill: {fgColor: {rgb: '1A1A2E'}},
                    alignment: {horizontal: 'center', vertical: 'center'},
                    border: {top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'}}
                };
                // Fines de semana en encabezado
                if (C > 0) {
                    const semIdx = (inicio + C - 1) % 7;
                    if (semIdx === 0 || semIdx === 6) {
                        ws[cellAddr].s.fill = {fgColor: {rgb: '991B1B'}};
                    }
                }
            } else {
                // Celda de nombre
                if (C === 0) {
                    ws[cellAddr].s = {
                        font: {bold: true},
                        alignment: {horizontal: 'left', vertical: 'center'},
                        border: {top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'}}
                    };
                } else {
                    // Celda de tipo de asistencia con color
                    const valor = ws[cellAddr].v;
                    const tipo = cfg.tipos.find(t => t.cod === valor);
                    const semIdx = (inicio + C - 1) % 7;
                    const esFinde = semIdx === 0 || semIdx === 6;
                    
                    ws[cellAddr].s = {
                        font: {
                            bold: !!valor,
                            color: tipo ? {rgb: tipo.color.replace('#', '')} : {rgb: '000000'}
                        },
                        fill: {fgColor: {rgb: esFinde ? 'FEF2F2' : 'FFFFFF'}},
                        alignment: {horizontal: 'center', vertical: 'center'},
                        border: {top: {style: 'thin'}, bottom: {style: 'thin'}, left: {style: 'thin'}, right: {style: 'thin'}}
                    };
                }
            }
        }
    }
    
    // Crear libro y descargar
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.mes);
    XLSX.writeFile(wb, 'Guardias_' + cfg.mes.replace(/ /g, '_') + '.xlsx');
}

async function reiniciarMes() {
    if (
        !confirm(
            'Reiniciar los registros del mes "' +
                cfg.mes +
                '"?\n\nEl personal NO se borra, solo los registros de asistencia.\n\nIMPORTANTE: Asegurate de haber descargado el Excel antes de continuar.',
        )
    )
        return;
    
    const confirmacion = prompt(
        'Esta acción es IRREVERSIBLE.\n\nPara confirmar, escribí el nombre del mes exactamente como aparece:\n\n' + cfg.mes,
        ''
    );
    
    if (confirmacion === null) return;
    
    if (confirmacion.trim().toUpperCase() !== cfg.mes.trim().toUpperCase()) {
        alert('El nombre del mes no coincide. Reinicio cancelado.');
        return;
    }
    
    await apiPost({}, 'limpiar');
    await registrarAuditoria('MES_REINICIAR', 'Mes reiniciado: ' + cfg.mes + ' (' + personal.length + ' personas)', 'admin');
    registros = {};
    alert('Mes reiniciado correctamente.');
    renderPlanilla();
}

async function cargarTurnos() {
    const data = await apiGet('turnos');
    turnos = data.filter((d) => d.nombre);
}

function renderTurnos() {
    const c = document.getElementById('lista-turnos');
    if (!c) return;
    if (!turnos.length) {
        c.innerHTML = '<p style="font-size:13px;color:#64748b;">Sin turnos creados.</p>';
        return;
    }
    c.innerHTML = turnos.map((t, i) =>
        '<div class="card" style="margin-bottom:.75rem;">' +
        '<div class="row-between" style="margin-bottom:.5rem;">' +
        '<div>' +
        '<div style="font-size:14px;font-weight:600;">' + t.nombre + '</div>' +
        '<div style="font-size:11px;color:#64748b;">' + t.personal.length + ' personas · Pass: <span class="pass-chip" translate="no">' + t.pass + '</span></div>' +
        '</div>' +
        '<span style="cursor:pointer;color:#ef4444;font-size:12px;font-weight:600;" onclick="eliminarTurno(' + i + ')">Eliminar turno</span>' +
        '</div>' +
        '<div style="border-top:1px solid #f1f5f9;padding-top:.6rem;">' +
        (t.personal.length === 0 ? '<p style="font-size:12px;color:#64748b;">Sin personal asignado.</p>' :
        t.personal.map((nombre, pi) =>
            '<div class="row-between" style="padding:5px 0;">' +
            '<span style="font-size:12px;">' + nombre + '</span>' +
            '<div style="display:flex;gap:6px;align-items:center;">' +
            '<span style="cursor:pointer;font-size:14px;' + (pi === 0 ? 'opacity:.25;pointer-events:none;' : '') + '" onclick="moverPersonaEnTurno(' + i + ',' + pi + ',-1)">↑</span>' +
            '<span style="cursor:pointer;font-size:14px;' + (pi === t.personal.length - 1 ? 'opacity:.25;pointer-events:none;' : '') + '" onclick="moverPersonaEnTurno(' + i + ',' + pi + ',1)">↓</span>' +
            '<span style="cursor:pointer;color:#ef4444;font-size:11px;font-weight:600;" onclick="quitarPersonaDeTurno(' + i + ',' + pi + ')">Quitar</span>' +
            '</div></div>'
        ).join('')) +
        '</div></div>'
    ).join('');
    const sel = document.getElementById('turno-sel-turno');
    if (sel) {
        sel.innerHTML = '<option value="">Selecciona turno</option>';
        turnos.forEach((t, i) => {
            const o = document.createElement('option');
            o.value = i;
            o.textContent = t.nombre;
            sel.appendChild(o);
        });
    }
    llenarPersonas('turno-sel-persona');
}

async function agregarTurno() {
    const nombre = sanitize(document.getElementById('inp-turno-nombre').value);
    const pass = sanitize(document.getElementById('inp-turno-pass').value);
    if (!nombre || !pass) {
        alert('Completa nombre y contraseña del turno.');
        return;
    }
    if (pass.length < 4) {
        alert('La contraseña debe tener al menos 4 caracteres.');
        return;
    }
    if (turnos.find((t) => t.nombre === nombre)) {
        alert('Ya existe ese turno.');
        return;
    }
    const btn = document.querySelector('[onclick="agregarTurno()"]');
    btn.textContent = 'Guardando...';
    btn.disabled = true;
    const id = nombre.replace(/[^a-zA-Z0-9]/g, '_');
    await apiPost({ id, nombre, pass, personal: [] }, 'turno');
    turnos.push({ id, nombre, pass, personal: [] });
    document.getElementById('inp-turno-nombre').value = '';
    document.getElementById('inp-turno-pass').value = '';
    btn.textContent = 'Crear turno';
    btn.disabled = false;
    renderTurnos();
    alert('Turno "' + nombre + '" creado correctamente.');
}

async function agregarPersonaATurno() {
    const turnoIdx = document.getElementById('turno-sel-turno').value;
    const persona = document.getElementById('turno-sel-persona').value;
    if (turnoIdx === '' || !persona) {
        alert('Selecciona turno y persona.');
        return;
    }
    const t = turnos[turnoIdx];
    if (t.personal.includes(persona)) {
        alert('Esa persona ya está en el turno.');
        return;
    }
    const btn = document.querySelector('[onclick="agregarPersonaATurno()"]');
    btn.textContent = 'Guardando...';
    btn.disabled = true;
    t.personal.push(persona);
    await apiPost({ ...t }, 'turno');
    btn.textContent = 'Asignar persona';
    btn.disabled = false;
    renderTurnos();
    alert('Persona agregada al ' + t.nombre);
}

async function eliminarTurno(i) {
    if (!confirm('Quitar el turno "' + turnos[i].nombre + '"?')) return;
    await apiDelete({ id: turnos[i].id }, 'turno');
    turnos.splice(i, 1);
    renderTurnos();
}

// Login jefe de turno
async function iniciarLoginTurno(){
  goTo('sc-turno-login');
  document.getElementById('inp-turno-login-pass').value='';
  document.getElementById('turno-login-err').style.display='none';
  await cargarTurnos();
}

async function doTurnoLogin() {
    const pass = document.getElementById('inp-turno-login-pass').value;
    const err = document.getElementById('turno-login-err');
    if (!pass) {
        err.textContent = 'Ingresa la contraseña.';
        err.style.display = 'block';
        return;
    }
    
    const turno = turnos.find((t) => t.pass === pass);
    if (!turno) {
        err.textContent = 'Contraseña incorrecta.';
        err.style.display = 'block';
        return;
    }
    err.style.display = 'none';
    document.getElementById('inp-turno-login-pass').value = '';
    await cargarConfig();
    await cargarRegistros();
    renderPlanillaTurno(turno);
    document.getElementById('turno-titulo').textContent =
        'Planilla — ' + turno.nombre;
    goTo('sc-turno-planilla');
}

function renderPlanillaTurno(turno) {
    const c = document.getElementById('planilla-turno-container');
    const personalTurno = personal.filter((p) =>
        turno.personal.includes(p.nombre),
    );
    if (!personalTurno.length) {
        c.innerHTML =
            '<p style="font-size:13px;color:#64748b;padding:1rem;">Sin personal asignado a este turno.</p>';
        return;
    }
    const inicio = parseInt(cfg.inicioSem) || 0;
    let h = '<table><thead><tr><th class="col-fixed">Apellido y Nombre</th>';
    for (let d = 1; d <= cfg.dias; d++) {
        const semIdx = (inicio + d - 1) % 7;
        const ds = DIAS_SEM[semIdx];
        const esFinde = semIdx === 0 || semIdx === 6;
        h +=
            '<th style="min-width:24px;' +
            (esFinde ? 'color:#ef4444;background:#fff5f5;' : '') +
            '">' +
            d +
            '<br><span style="font-size:9px;font-weight:400;">' +
            ds +
            '</span></th>';
    }
    h += '</tr></thead><tbody>';
    personalTurno.forEach((p) => {
        h += '<tr><td class="col-fixed">' + p.nombre + '</td>';
        for (let d = 1; d <= cfg.dias; d++) {
            const v =
                registros[p.nombre] && registros[p.nombre][d]
                    ? registros[p.nombre][d]
                    : '';
            const t = cfg.tipos.find((x) => x.cod === v);
            const col = t ? t.color : '';
            const semIdx = (inicio + d - 1) % 7;
            const esFinde = semIdx === 0 || semIdx === 6;
            h +=
                '<td style="color:' +
                col +
                ';font-weight:' +
                (v ? '700' : '400') +
                ';background:' +
                (esFinde ? '#fff5f5' : '') +
                ';"><span translate="no">' +
                v +
                '</span></td>';
        }
        h += '</tr>';
    });
    h += '</tbody></table>';
    c.innerHTML = h;
}

async function cambiarPassAdmin(){
  const actual=prompt('Ingresa la contraseña actual:','');
  if(actual===null)return;
  await cargarConfig();
  const actualHash = await hashPassword(actual);
  if(actualHash !== ADMIN_PASS_HASH_GLOBAL){alert('Contraseña actual incorrecta.');return;}
  const nueva=prompt('Ingresa la nueva contraseña (min. 6 caracteres):','');
  if(nueva===null)return;
  if(nueva.trim().length<6){alert('La contraseña debe tener al menos 6 caracteres.');return;}
  const confirmar=prompt('Confirmá la nueva contraseña:','');
  if(confirmar===null)return;
  if(nueva.trim()!==confirmar.trim()){alert('Las contraseñas no coinciden.');return;}
  const nuevaHash = await hashPassword(nueva.trim());
  
  // Guardar en Cosmos DB (global - todos los dispositivos)
  await apiPost({ id: 'admin_pass', hash: nuevaHash }, 'config');
  ADMIN_PASS_HASH_GLOBAL = nuevaHash;
  
  alert('Contraseña cambiada correctamente en todos los dispositivos.');
  await registrarAuditoria('PASS_ADMIN_CAMBIAR', 'Contraseña de administrador modificada (global)', 'admin');
}

async function moverPersonaEnTurno(turnoIdx, personaIdx, dir) {
    const t = turnos[turnoIdx];
    const j = personaIdx + dir;
    if (j < 0 || j >= t.personal.length) return;
    [t.personal[personaIdx], t.personal[j]] = [t.personal[j], t.personal[personaIdx]];
    await apiPost({ ...t }, 'turno');
    renderTurnos();
}

async function quitarPersonaDeTurno(turnoIdx, personaIdx) {
    const t = turnos[turnoIdx];
    const nombre = t.personal[personaIdx];
    if (!confirm('Quitar a ' + nombre + ' del ' + t.nombre + '?')) return;
    t.personal.splice(personaIdx, 1);
    await apiPost({ ...t }, 'turno');
    renderTurnos();
    alert(nombre + ' quitado del turno.');
}

// === FUNCIONES DE HISTORIAL (PAUSADAS) ===
// Reactivar cuando se ofrezca archivado en la nube para clientes empresa.
// Requiere descomentar el tab "Historial" en index.html

let archivosCache = [];

async function cargarArchivos() {
    const data = await apiGet('archivos');
    archivosCache = data.filter(d => d.mes);
    archivosCache.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

async function renderHistorial() {
    const c = document.getElementById('lista-historial');
    c.innerHTML = '<div class="loader"><div class="spinner"></div><br>Cargando...</div>';
    await cargarArchivos();
    if (!archivosCache.length) {
        c.innerHTML = '<p style="font-size:13px;color:#64748b;">No hay meses archivados.</p>';
        return;
    }
    c.innerHTML = archivosCache.map((a, i) => {
        const fecha = new Date(a.fecha).toLocaleDateString('es-AR');
        return '<div class="row-between" style="padding:10px 0;">' +
            '<div>' +
            '<div style="font-size:14px;font-weight:600;">' + a.mes + '</div>' +
            '<div style="font-size:11px;color:#64748b;">Archivado el ' + fecha + ' · ' + (a.personal ? a.personal.length : 0) + ' personas</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;">' +
            '<span style="cursor:pointer;color:#3b82f6;font-size:12px;font-weight:600;" onclick="descargarHistorial(' + i + ')">Descargar Excel</span>' +
            '<span style="cursor:pointer;color:#ef4444;font-size:12px;font-weight:600;" onclick="eliminarHistorial(' + i + ')">Eliminar</span>' +
            '</div></div>';
    }).join('');
}

function descargarHistorial(i) {
    const archivo = archivosCache[i];
    const inicio = parseInt(cfg.inicioSem) || 0;
    const datos = [];
    
    const header = ['Apellido y Nombre'];
    const dias = archivo.dias || 31;
    for (let d = 1; d <= dias; d++) {
        const semIdx = (inicio + d - 1) % 7;
        header.push(d + ' (' + DIAS_SEM[semIdx] + ')');
    }
    datos.push(header);
    
    (archivo.personal || []).forEach(p => {
        const fila = [p.nombre];
        for (let d = 1; d <= dias; d++) {
            fila.push(archivo.registros && archivo.registros[p.nombre] && archivo.registros[p.nombre][d] ? archivo.registros[p.nombre][d] : '');
        }
        datos.push(fila);
    });
    
    const ws = XLSX.utils.aoa_to_sheet(datos);
    ws['!cols'] = [{wch: 30}];
    for (let d = 1; d <= dias; d++) ws['!cols'].push({wch: 7});
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, archivo.mes.substring(0, 30));
    XLSX.writeFile(wb, 'Historial_' + archivo.mes.replace(/ /g, '_') + '.xlsx');
}

async function eliminarHistorial(i) {
    const archivo = archivosCache[i];
    if (!confirm('Eliminar permanentemente el archivo de "' + archivo.mes + '"? Esta accion no se puede deshacer.')) return;
    await apiDelete({ id: archivo.id, mes: archivo.mes }, 'archivo');
    await registrarAuditoria('HISTORIAL_ELIMINAR', 'Eliminado mes archivado: ' + archivo.mes, 'admin');
    archivosCache.splice(i, 1);
    renderHistorial();
}

async function migrarUsuariosAutomaticos() {
    if (!confirm('Esto va a asignar usuarios automáticos. Formato: 1 letra de cada nombre + apellido (ej: jlrodriguez).\n\nLos que ya tienen usuario NO se tocan.\n\n¿Continuar?')) return;
    
    const btn = document.querySelector('[onclick="migrarUsuariosAutomaticos()"]');
    btn.textContent = 'Asignando...';
    btn.disabled = true;
    
    let asignados = 0;
    let yaTenian = 0;
    const usuariosUsados = personal.filter(p => p.usuario).map(p => p.usuario);
    
    for (const p of personal) {
        if (p.usuario) {
            yaTenian++;
            continue;
        }
        // Generar usuario automatico
        const partes = p.nombre.split(',').map(s => s.trim());
        let apellido = partes[0] || '';
        let nombres = (partes[1] || '').split(' ').filter(n => n.length > 0);
        
        // Limpiar apellido (sin acentos, sin espacios, minusculas)
        apellido = apellido.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
        
        // Tomar primera letra de cada nombre
        let iniciales = '';
        for (const nombre of nombres) {
            const limpio = nombre.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '');
            if (limpio) iniciales += limpio.charAt(0);
        }
        
        let usuarioBase = iniciales + apellido;
        let usuarioFinal = usuarioBase;
        let contador = 1;
        
        // Si ya existe, agregar numero
        while (usuariosUsados.includes(usuarioFinal)) {
            contador++;
            usuarioFinal = usuarioBase + contador;
        }
        
        p.usuario = usuarioFinal;
        usuariosUsados.push(usuarioFinal);
        await apiPost({ ...p }, 'personal');
        asignados++;
    }
    
    btn.textContent = '👤 Migrar usuarios automáticos (ejecutar una sola vez)';
    btn.disabled = false;
    alert('Listo!\n\n' + asignados + ' usuarios asignados.\n' + yaTenian + ' ya tenían usuario.\n\nPodés editar cada uno desde el listado de personal.');
    await registrarAuditoria('USUARIOS_MIGRAR', asignados + ' usuarios asignados automáticamente', 'admin');
    renderPersonal();
}

async function migrarPasswordsAHash() {
    if (!confirm('Esto va a cifrar todas las contraseñas existentes. Solo hay que ejecutarlo UNA vez. ¿Continuar?')) return;
    
    const btn = document.querySelector('[onclick="migrarPasswordsAHash()"]');
    btn.textContent = 'Cifrando...';
    btn.disabled = true;
    
    let cifradas = 0;
    let yaCifradas = 0;
    
    for (const p of personal) {
        if (p.pass && p.pass.length === 64 && /^[a-f0-9]+$/.test(p.pass)) {
            yaCifradas++;
            continue;
        }
        const passHash = await hashPassword(p.pass);
        p.pass = passHash;
        await apiPost({ ...p }, 'personal');
        cifradas++;
    }
    
    btn.textContent = '🔒 Migrar contraseñas a cifrado (ejecutar una sola vez)';
    btn.disabled = false;
    await registrarAuditoria('HASH_MIGRAR', cifradas + ' contraseñas cifradas, ' + yaCifradas + ' ya estaban cifradas', 'admin');
    alert('Listo!\n\n' + cifradas + ' contraseñas cifradas.\n' + yaCifradas + ' ya estaban cifradas.');
    renderPersonal();
}

let auditoriaCache = [];

async function cargarAuditoria() {
    const data = await apiGet('auditoria');
    auditoriaCache = data.filter(d => d.timestamp);
    auditoriaCache.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function renderAuditoria() {
    const c = document.getElementById('lista-auditoria');
    c.innerHTML = '<div class="loader"><div class="spinner"></div><br>Cargando...</div>';
    await cargarAuditoria();
    if (!auditoriaCache.length) {
        c.innerHTML = '<p style="font-size:13px;color:#64748b;">No hay registros de auditoria.</p>';
        return;
    }
    
    const colores = {
        'LOGIN_ADMIN': '#10b981',
        'LOGIN_CONSULTA': '#3b82f6',
        'LOGIN_ADMIN_FALLIDO': '#ef4444',
        'PERSONAL_CREAR': '#10b981',
        'PERSONAL_EDITAR': '#f59e0b',
        'PERSONAL_ELIMINAR': '#ef4444',
        'CELDA_EDITAR': '#3b82f6',
        'CELDA_BORRAR': '#ef4444',
        'RANGO_APLICAR': '#8b5cf6',
        'MES_ARCHIVAR': '#f59e0b',
        'HISTORIAL_ELIMINAR': '#ef4444',
        'PASS_ADMIN_CAMBIAR': '#f59e0b',
        'HASH_MIGRAR': '#10b981'
    };
    
    c.innerHTML = auditoriaCache.slice(0, 200).map(log => {
        const fecha = new Date(log.timestamp).toLocaleString('es-AR');
        const color = colores[log.accion] || '#64748b';
        return '<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="font-size:12px;font-weight:600;color:' + color + ';">' + log.accion + '</span>' +
            '<span style="font-size:11px;color:#64748b;">' + fecha + '</span>' +
            '</div>' +
            '<div style="font-size:13px;color:#1a1a2e;">' + log.detalle + '</div>' +
            '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">por: ' + log.usuario + '</div>' +
            '</div>';
    }).join('');
}

async function limpiarAuditoria() {
    if (!confirm('Eliminar TODOS los registros de auditoria? Esta accion no se puede deshacer.')) return;
    if (!confirm('Estas seguro? Vas a perder el historial completo de acciones.')) return;
    
    for (const log of auditoriaCache) {
        await apiDelete({ id: log.id, fecha: log.fecha }, 'auditoria');
    }
    auditoriaCache = [];
    renderAuditoria();
    alert('Auditoria limpiada.');
}

goTo('sc-home');

// Mantener Azure despierto cuando la app esta abierta
function keepAliveAzure() {
    fetch(API_URL, {
        headers: { 'X-API-Key': API_KEY },
        signal: AbortSignal.timeout(10000)
    }).catch(() => {});
}
setInterval(keepAliveAzure, 4 * 60 * 1000);
keepAliveAzure();

// Sistema de tema (claro/oscuro)
function toggleTema() {
    const esOscuro = document.body.classList.toggle('dark');
    localStorage.setItem('tema', esOscuro ? 'dark' : 'light');
    document.getElementById('theme-toggle-btn').textContent = esOscuro ? '☀️' : '🌙';
}

function cargarTema() {
    const tema = localStorage.getItem('tema') || 'light';
    if (tema === 'dark') {
        document.body.classList.add('dark');
        document.getElementById('theme-toggle-btn').textContent = '☀️';
    }
}

cargarTema();