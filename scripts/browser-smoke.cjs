// Local browser verification. Uses an isolated in-memory API, never real Firebase.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

async function main() {
  const firebasePath = require.resolve('../server/src/config/firebase');
  require.cache[firebasePath] = { id: firebasePath, filename: firebasePath, loaded: true, exports: { db: null, isConfigured: false } };
  const { app } = require('../server/src/index');
  const token = require('../server/src/lib/auth').signToken({ id: 'smoke', email: 'smoke@example.com' });
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  let vite;
  if (process.argv.includes('--dev')) {
    vite = await (await import('vite')).createServer({ root: path.resolve(__dirname, '../web'), configFile: path.resolve(__dirname, '../web/vite.config.js'), cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'gestor-vite-smoke-')), optimizeDeps: { include: ['react', 'react-dom/client', 'jspdf'] }, server: { middlewareMode: true, hmr: false, proxy: {} }, logLevel: 'error' });
    app.use(vite.middlewares);
  } else app.use(express.static(path.resolve(__dirname, '../web/dist')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gestor-smoke-'));
  const browserPath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
  const pending = new Map();
  const errors = [];
  const screenshots = {};
  let sequence = 0;
  let buffer = '';
  let sessionId;
  browser.on('error', (error) => { for (const waiter of pending.values()) waiter.reject(error); });
  browser.stdio[4].on('data', (data) => {
    buffer += data.toString();
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      const waiter = pending.get(message.id);
      if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((a) => a.value || a.description).join(' '));
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text);
    }
  });
  const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }) + '\0');
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const pageText = await evaluate('document.body.innerText.slice(0, 1200)');
    throw new Error(`Browser condition failed: ${expression}\nPage text: ${pageText}\nBrowser errors: ${errors.join(' | ') || 'none'}`);
  };
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`${base}/api${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    assert.ok(response.ok, payload.message);
    return payload;
  };
  const screenshot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const filename = path.join(profile, `${name}.png`);
    fs.writeFileSync(filename, Buffer.from(result.data, 'base64'));
    screenshots[name] = filename;
  };
  try {
    const sector = await request('/job-functions', 'POST', { name: 'Atención' });
    const night = await request('/shiftTypes', 'POST', { name: 'Tarde-Noche', jobFunctionId: sector.id, startTime: '18:00', endTime: '23:00' });
    const employee = await request('/employees', 'POST', { name: 'Lautaro', jobFunctionIds: [sector.id], preferredShiftTypeIds: [night.id] });
    await request('/employees', 'POST', { name: 'Ana', active: false, jobFunctionIds: [sector.id] });
    if (process.argv.includes('--fullscreen')) {
      for (let index = 1; index <= 10; index += 1) await request('/employees', 'POST', { name: `Persona de prueba ${index}`, jobFunctionIds: [sector.id] });
    }
    await request('/schedules/generate', 'POST', { month: '2026-10' });
    await send('Browser.getVersion', {}, null);
    const target = await send('Target.createTarget', { url: 'about:blank' }, null);
    sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('token', ${JSON.stringify(token)}); localStorage.setItem('user', JSON.stringify({name:'Prueba local',email:'smoke@example.com'}));` });
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base });
    await waitFor("document.querySelector('.agenda-employee')?.textContent.includes('Ana')");
    await evaluate("document.querySelector('input[type=month]').value = '2026-10'; document.querySelector('input[type=month]').dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('input[type=month]').dispatchEvent(new Event('change',{bubbles:true}));");
    await waitFor("document.querySelector('.agenda-event')");
    assert.ok(await evaluate("document.body.textContent.includes('Tarde-Noche') && document.body.textContent.includes('Inactivo')"));
    await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Empleados')).click()");
    await waitFor("document.getElementById('employee-form')");
    await evaluate("[...document.querySelectorAll('.list li')].find(li=>li.textContent.includes('Lautaro')).querySelector('button').click()");
    await waitFor("document.querySelector('select[aria-label=\"Disponibilidad Jueves\"]')");
    assert.ok(await evaluate("[...document.querySelector('select[aria-label=\"Disponibilidad Jueves\"]').options].some(o=>o.textContent.includes('Tarde-Noche'))"));
    const selectValue = `type:${night.id}`;
    await evaluate(`(() => { const s = document.querySelector('select[aria-label="Disponibilidad Jueves"]'); s.value = ${JSON.stringify(selectValue)}; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await evaluate("document.getElementById('employee-form').requestSubmit()");
    await waitFor("document.getElementById('employee-form').textContent.includes('Agregar empleado')");
    assert.equal((await request('/employees')).find((e) => e.id === employee.id).weeklySchedule.thursday.shiftTypeId, night.id);
    await send('Page.reload');
    await waitFor("document.querySelector('.agenda-event')");
    await evaluate("document.querySelector('.agenda-event .calendar-edit').click()");
    await waitFor("document.getElementById('manual-shift-form').textContent.includes('Editar turno del calendario')");
    await evaluate("(() => {const input = document.querySelector('#manual-shift-form input[type=time]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'19:00'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await evaluate("document.getElementById('manual-shift-form').requestSubmit()");
    await waitFor("document.body.textContent.includes('Cambio protegido')");
    await screenshot('desktop');
    if (process.argv.includes('--export')) {
      await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: profile }, null);
      const whatsApp = await evaluate("(() => {const link=document.querySelector('.whatsapp-share');return {href:link?.href,message:new URL(link.href).searchParams.get('text')};})()");
      assert.ok(whatsApp.href.startsWith('https://wa.me/?text='));
      assert.ok(whatsApp.message.includes('Calendario de turnos') && whatsApp.message.includes('Lautaro') && whatsApp.message.includes('Tarde-Noche'));
      await evaluate("[...document.querySelectorAll('.calendar-export button')].find(b=>b.textContent==='Descargar PDF').click()");
      await waitFor("document.querySelector('.export-status')?.textContent.includes('.pdf')");
      const download = async (extension) => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const name = fs.readdirSync(profile).find((file) => file.startsWith('calendario-') && file.endsWith(extension));
          if (name) return { name, data: fs.readFileSync(path.join(profile, name)) };
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`No se descargó el archivo ${extension}`);
      };
      const pdf = await download('.pdf');
      assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.data.toString('latin1').trimEnd().endsWith('%%EOF'));
      await evaluate("[...document.querySelectorAll('.calendar-export button')].find(b=>b.textContent==='Descargar CSV / Excel').click()");
      await waitFor("document.querySelector('.export-status')?.textContent.includes('.csv')");
      const csv = await download('.csv');
      assert.ok(csv.data.toString('utf8').includes('Lautaro') && csv.data.toString('utf8').includes('19:00'));
      await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__sharedCalendar={name:data.files[0].name,type:data.files[0].type,head:(await data.files[0].text()).slice(0,5)};}})");
      await evaluate("[...document.querySelectorAll('.calendar-export > .action-row button')].find(b=>b.textContent==='Compartir PDF').click()");
      await waitFor("document.querySelector('.export-dialog')");
      await evaluate("[...document.querySelectorAll('.export-dialog button')].find(b=>b.textContent==='Elegir aplicación y compartir').click()");
      await waitFor("!document.querySelector('.export-dialog')");
      const shared = await evaluate('window.__sharedCalendar');
      assert.equal(shared.type, 'application/pdf'); assert.equal(shared.head, '%PDF-');
      await evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('Cancelado','AbortError')}})");
      await evaluate("[...document.querySelectorAll('.calendar-export > .action-row button')].find(b=>b.textContent==='Compartir PDF').click()");
      await waitFor("document.querySelector('.export-dialog')");
      await evaluate("[...document.querySelectorAll('.export-dialog button')].find(b=>b.textContent==='Elegir aplicación y compartir').click()");
      await waitFor("document.querySelector('.export-dialog')?.textContent.includes('Envío cancelado')");
      await evaluate("[...document.querySelectorAll('.export-dialog button')].find(b=>b.textContent==='Cerrar').click()");
      await evaluate("Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false})");
      await evaluate("[...document.querySelectorAll('.calendar-export > .action-row button')].find(b=>b.textContent==='Compartir PDF').click()");
      await waitFor("document.querySelector('.export-dialog')?.textContent.includes('Este navegador no permite compartir')");
      assert.ok(await evaluate("[...document.querySelectorAll('.export-dialog button')].some(b=>b.textContent==='Descargar archivo')"));
      await screenshot('export-fallback');
      await evaluate("[...document.querySelectorAll('.export-dialog button')].find(b=>b.textContent==='Cerrar').click()");
      await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Manual de uso')).click()");
      await waitFor("document.querySelector('.manual-frame')?.contentDocument?.querySelector('#exportar')");
      await screenshot('manual-integrado');
      await evaluate("[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('Calendario')).click()");
      await waitFor("document.querySelector('.agenda-grid')");
    }
    if (process.argv.includes('--fullscreen')) {
      const checkFullscreen = async (name) => {
        await waitFor("document.querySelector('.calendar-fullscreen')");
        await screenshot(name);
        const layout = await evaluate("(() => {const card=document.querySelector('.agenda-card').getBoundingClientRect(); const scroll=document.querySelector('.agenda-scroll'); const rect=scroll.getBoundingClientRect();return {top:card.top,bottom:card.bottom,height:innerHeight,gridBottom:rect.bottom,gridHeight:rect.height,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight};})()");
        assert.ok(layout.top >= 0 && layout.bottom <= layout.height + 1 && layout.gridHeight > 80 && layout.gridBottom <= layout.height, `Calendario ajustado al alto: ${JSON.stringify(layout)}`);
        assert.ok(layout.scrollHeight > layout.clientHeight, 'El equipo largo tiene desplazamiento dentro de la tabla');
        assert.ok(await evaluate("[...document.querySelectorAll('.agenda-event strong')].every(e=>e.scrollWidth<=e.clientWidth+1)"), 'Las horas no desbordan las tarjetas');
        await evaluate("document.querySelector('.agenda-scroll').scrollTop=200;document.querySelector('.agenda-scroll').scrollLeft=200;");
        const sticky = await evaluate("(() => {const scroll=document.querySelector('.agenda-scroll').getBoundingClientRect(); const day=document.querySelector('.agenda-day-heading').getBoundingClientRect();const employee=document.querySelector('.agenda-employee').getBoundingClientRect(); return {scrollTop:scroll.top,dayTop:day.top,scrollLeft:scroll.left,employeeLeft:employee.left};})()");
        assert.ok(Math.abs(sticky.dayTop-sticky.scrollTop) < 3 && Math.abs(sticky.employeeLeft-sticky.scrollLeft) < 3, `Encabezados visibles: ${JSON.stringify(sticky)}`);
      };
      await evaluate("document.querySelector('.fullscreen-toggle').click()");
      await checkFullscreen('fullscreen-month');
      assert.ok(await evaluate('Boolean(document.fullscreenElement)'), 'Se verificó pantalla completa nativa');
      await evaluate("document.querySelector('.fullscreen-toggle').click()");
      await waitFor("!document.querySelector('.calendar-fullscreen')");
      assert.notEqual(await evaluate('document.body.style.overflow'), 'hidden', 'Al salir se recupera el desplazamiento normal');
      await evaluate("document.querySelector('.calendar-filters select').value='week';document.querySelector('.calendar-filters select').dispatchEvent(new Event('change',{bubbles:true}));");
      await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 600, deviceScaleFactor: 1, mobile: false });
      await evaluate("Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false});document.querySelector('.fullscreen-toggle').click()");
      await checkFullscreen('fullscreen-week-fallback');
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await waitFor("!document.querySelector('.calendar-fullscreen')");
      assert.notEqual(await evaluate('document.body.style.overflow'), 'hidden', 'Escape restaura el desplazamiento de la página');
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.reload');
    await waitFor("document.querySelector('.agenda-grid')");
    assert.equal(await evaluate("document.querySelectorAll('.agenda-day-heading').length"), 7);
    const mobileLayout = await evaluate("({width:document.documentElement.scrollWidth, viewport:innerWidth, overflowing:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>392 && !e.closest('.agenda-scroll')).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))})");
    assert.ok(mobileLayout.width <= 392, `Desbordamiento móvil: ${JSON.stringify(mobileLayout)}`);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    await screenshot('mobile');
    console.log(JSON.stringify({ browser: 'Chrome headless', desktop: '1366x900', mobile: '390x844', checks: ['calendario', 'inactivos', 'tipo dinámico', 'regla diaria guardada', 'recarga', 'edición protegida', 'vista semanal móvil', 'sin errores de consola', ...(process.argv.includes('--fullscreen') ? ['pantalla completa nativa mensual', 'vista ampliada semanal 1024x600', 'encabezados fijos', 'horarios sin desborde', 'salida con botón y Escape'] : []), ...(process.argv.includes('--export') ? ['descarga PDF real', 'descarga CSV real', 'archivo compartido simulado', 'cancelación de compartir', 'alternativa sin Web Share', 'manual dentro del sistema'] : [])], screenshots, result: 'PASS' }, null, 2));
  } finally {
    await Promise.race([send('Browser.close', {}, null).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    browser.kill();
    if (vite) await vite.close();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    // Profile stays in the OS temporary directory; no user Chrome profile is used.
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
