import { useEffect, useMemo, useRef, useState } from 'react';
import { calendarCsv, calendarFilename, calendarWhatsAppMessage } from './lib/calendar-export';

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url; link.download = file.name; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function canShareFile(file) {
  try { return Boolean(navigator.share && navigator.canShare?.({ files: [file] })); }
  catch { return false; }
}

export default function CalendarExportControls({ snapshot, disabled = false }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [prepared, setPrepared] = useState(null);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const operationRef = useRef(false);
  const whatsAppUrl = useMemo(() => `https://wa.me/?text=${encodeURIComponent(calendarWhatsAppMessage(snapshot))}`, [snapshot]);
  const close = () => { setPrepared(null); window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true })); };

  useEffect(() => {
    if (!prepared) return;
    const previous = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [prepared]);

  const prepare = async (format, share = false) => {
    if (operationRef.current || disabled || !snapshot.canExport) return;
    operationRef.current = true; setBusy(true); setMessage('Preparando archivo…');
    try {
      // Capture the selected period before awaiting the PDF module.
      const selected = snapshot;
      const blob = format === 'csv' ? new Blob([calendarCsv(selected)], { type: 'text/csv;charset=utf-8' }) : await (await import('./lib/calendar-pdf')).createCalendarPdf(selected);
      const file = new File([blob], calendarFilename(selected, format), { type: format === 'csv' ? 'text/csv' : 'application/pdf' });
      if (share) {
        setPrepared({ file, periodLabel: selected.periodLabel, status: selected.status, sector: selected.sector, shareable: canShareFile(file) });
        setMessage('PDF listo para compartir.');
      } else {
        downloadFile(file);
        setMessage(`Descarga preparada: ${file.name}`);
      }
    } catch (error) { setMessage('No se pudo preparar el archivo. Volvé a intentar.'); }
    finally { operationRef.current = false; setBusy(false); }
  };

  const sharePrepared = async () => {
    if (!prepared || operationRef.current) return;
    operationRef.current = true; setBusy(true);
    try {
      // Called directly by a second click: preserve the browser's user activation.
      await navigator.share({ files: [prepared.file], title: `Gestor de Turnos · ${prepared.periodLabel}` });
      setMessage('Archivo entregado al menú para compartir.'); close();
    } catch (error) {
      setMessage(error.name === 'AbortError' ? 'Envío cancelado. Podés volver a compartir o descargar el PDF.' : 'No se pudo abrir el envío. Descargá el PDF y adjuntalo en tu aplicación.');
    } finally { operationRef.current = false; setBusy(false); }
  };

  const dialogKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) close(); }
    if (event.key === 'Tab') {
      const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href]')];
      const first = buttons[0]; const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };

  return <div className="calendar-export">
    <div className="action-row">
      <button type="button" className="secondary small" disabled={disabled || busy || !snapshot.canExport} onClick={() => prepare('pdf')}>{busy ? 'Preparando…' : 'Descargar PDF'}</button>
      <button type="button" className="secondary small" disabled={disabled || busy || !snapshot.canExport} onClick={() => prepare('csv')}>Descargar CSV / Excel</button>
      <button ref={triggerRef} type="button" className="secondary small" disabled={disabled || busy || !snapshot.canExport} onClick={() => prepare('pdf', true)}>Compartir PDF</button>
      <a className={`button small whatsapp-share${disabled || busy || !snapshot.canExport ? ' disabled' : ''}`} href={snapshot.canExport && !disabled && !busy ? whatsAppUrl : undefined} target="_blank" rel="noreferrer" aria-disabled={disabled || busy || !snapshot.canExport}>
        Enviar por WhatsApp
      </a>
    </div>
    <small className="export-description">Exporta el período y sector seleccionados. WhatsApp abre un mensaje con los turnos; para adjuntar el PDF, usá Compartir PDF.</small>
    <span className="export-status" role="status" aria-live="polite">{message}</span>
    {prepared && <div className="export-overlay" onKeyDown={dialogKeyDown} onClick={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section ref={dialogRef} className="card export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" aria-describedby="export-dialog-description">
        <h3 id="export-dialog-title">Calendario listo para enviar</h3>
        <p id="export-dialog-description">{prepared.periodLabel} · {prepared.sector}<br /><strong>{prepared.status}</strong></p>
        <p className="export-filename">{prepared.file.name}</p>
        {prepared.shareable ? <p>Elegí una aplicación en el menú del dispositivo. El archivo sólo se envía cuando vos lo indicás.</p> : <p>Este navegador no permite compartir archivos directamente. Descargá el PDF y adjuntalo en WhatsApp, correo u otra aplicación.</p>}
        <div className="action-row">
          {prepared.shareable && <button type="button" disabled={busy} onClick={sharePrepared}>Elegir aplicación y compartir</button>}
          <button type="button" className="secondary" disabled={busy} onClick={() => { downloadFile(prepared.file); setMessage('PDF preparado para descargar y adjuntar.'); }}>Descargar archivo</button>
          <button type="button" className="secondary" disabled={busy} onClick={close}>Cerrar</button>
        </div>
        <p className="muted">Si modificás el calendario después, prepará un archivo nuevo antes de enviarlo.</p>
        <span role="status" aria-live="polite">{message}</span>
      </section>
    </div>}
  </div>;
}
