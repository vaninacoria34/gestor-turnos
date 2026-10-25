import { assignmentStatus, displayDate, groupCalendarWeeks } from './calendar-export.js';

const clean = (value, limit = 400) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\u0020-\u00ff]/g, '').slice(0, limit);

export async function createCalendarPdf(snapshot, generatedAt = new Date()) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Calendario ${snapshot.periodLabel}`, author: 'Vanina Coria - ALFHA Soluciones Digitales', subject: snapshot.status });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 12;
  const bottom = height - 19;
  const tableWidth = width - 2 * margin;
  const nameWidth = 43;
  const fontSize = 7.4;
  const lineHeight = 3.5;
  let firstPage = true;
  const dateStamp = generatedAt.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const startPage = (label) => {
    if (!firstPage) doc.addPage();
    firstPage = false;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(35, 107, 69);
    doc.text('Gestor de Turnos', margin, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40, 50, 45);
    doc.text(clean(`${snapshot.periodLabel} | ${snapshot.sector}`, 220), margin, 21);
    doc.setTextColor(snapshot.status.includes('SIN CONFIRMAR') ? 150 : 35, snapshot.status.includes('SIN CONFIRMAR') ? 65 : 85, 30);
    doc.text(clean(`${snapshot.status}${snapshot.hasManualShifts ? ' | Incluye turnos manuales' : ''}`), margin, 27);
    doc.setFontSize(7.5); doc.setTextColor(70, 75, 70);
    doc.text(clean(`Generado: ${dateStamp} (Argentina) | Advertencias: ${snapshot.warnings.length}`), margin, 32);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(clean(label), margin, 39);
    return 44;
  };
  const header = (dates, y) => {
    const columnWidth = (tableWidth - nameWidth) / dates.length;
    doc.setFillColor(231, 242, 234); doc.setDrawColor(192, 210, 197); doc.setTextColor(35, 75, 50); doc.setFont('helvetica', 'bold'); doc.setFontSize(fontSize);
    doc.rect(margin, y, nameWidth, 11, 'FD'); doc.text('Empleado / sector', margin + 2, y + 6.5);
    dates.forEach((date, index) => {
      const x = margin + nameWidth + index * columnWidth;
      doc.rect(x, y, columnWidth, 11, 'FD');
      doc.text(clean(displayDate(date, true)), x + 2, y + 6.5);
    });
    return y + 11;
  };
  const wrapped = (text, size) => doc.splitTextToSize(clean(text), size - 4);
  for (const week of groupCalendarWeeks(snapshot.dates)) {
    const label = `Calendario: ${displayDate(week[0])} al ${displayDate(week.at(-1))}`;
    let y = header(week, startPage(label));
    const columnWidth = (tableWidth - nameWidth) / week.length;
    if (!snapshot.rows.length) {
      doc.setFont('helvetica', 'normal'); doc.text('No hay empleados o turnos para este filtro.', margin + 2, y + 7);
    }
    for (const employee of snapshot.rows) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(fontSize);
      const nameLines = [...wrapped(employee.name, nameWidth), ...wrapped(employee.sectors, nameWidth), ...(employee.employeeStatus !== 'Activo' ? wrapped(employee.employeeStatus, nameWidth) : [])];
      const columns = week.map((date) => {
        const cell = employee.cells.find((entry) => entry.date === date);
        if (!cell.shifts.length) return wrapped(cell.emptyLabel, columnWidth);
        const lines = cell.rest ? ['DESCANSO CONFIGURADO'] : [];
        for (const [index, shift] of cell.shifts.entries()) {
          if (index) lines.push('');
          lines.push(...wrapped(`${shift.startTime} - ${shift.endTime}`, columnWidth), ...wrapped(shift.shiftTypeName, columnWidth), ...wrapped(shift.jobFunction || 'Sin sector', columnWidth), ...wrapped(`${assignmentStatus(shift)}${shift.manuallyEdited ? ' / cambio protegido' : ''}`, columnWidth));
        }
        return lines;
      });
      // Split unusually tall employee rows across pages; never clip their shifts.
      let offset = 0;
      const totalLines = Math.max(nameLines.length, ...columns.map((lines) => lines.length));
      while (offset < totalLines) {
        if (y + 15 > bottom) y = header(week, startPage(`${label} (continuación)`));
        const capacity = Math.max(1, Math.floor((bottom - y - 4) / lineHeight));
        const count = Math.min(totalLines - offset, capacity);
        const rowHeight = Math.max(15, count * lineHeight + 4);
        doc.setDrawColor(205, 215, 207); doc.setFillColor(246, 249, 246);
        doc.rect(margin, y, nameWidth, rowHeight, 'FD'); doc.setTextColor(40, 55, 45);
        const nameSlice = offset ? wrapped(`${employee.name} (continúa)`, nameWidth).slice(0, count) : nameLines.slice(0, count);
        doc.text(nameSlice, margin + 2, y + 4.5, { lineHeightFactor: 1.34 });
        columns.forEach((lines, index) => {
          const x = margin + nameWidth + index * columnWidth;
          doc.rect(x, y, columnWidth, rowHeight);
          const slice = lines.slice(offset, offset + count);
          if (slice.length) doc.text(slice, x + 2, y + 4.5, { lineHeightFactor: 1.34 });
        });
        y += rowHeight;
        offset += count;
      }
    }
  }
  if (snapshot.warnings.length) {
    let y = startPage('Advertencias para revisar');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    for (const warning of snapshot.warnings) {
      const lines = doc.splitTextToSize(clean(`${displayDate(warning.date)} - ${warning.message}`, 1600), tableWidth - 4);
      for (const line of lines) {
        if (y + 5 > bottom) { y = startPage('Advertencias (continuación)'); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); }
        doc.text(line, margin + 2, y); y += 4;
      }
      y += 3;
    }
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(75, 95, 80);
    doc.text('Vanina Coria - 2026 - ALFHA Soluciones Digitales', margin, height - 10);
    doc.text('Gracias por confiar en nosotros.', margin, height - 6);
    doc.text(`Página ${page} de ${pages}`, width - margin, height - 10, { align: 'right' });
  }
  return doc.output('blob');
}
