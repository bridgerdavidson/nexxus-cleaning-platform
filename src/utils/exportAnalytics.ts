import { BookingTrendData, AnalyticsMetrics } from '../hooks/useAnalyticsData';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportToCSV(
  bookingTrends: BookingTrendData[],
  metrics: AnalyticsMetrics,
  startDate: Date,
  endDate: Date
) {
  // Create CSV content
  let csvContent = 'Analytics Report\n';
  csvContent += `Date Range: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}\n\n`;

  // Metrics section
  csvContent += 'Key Metrics\n';
  csvContent += `Average Cleaning Duration (minutes),${metrics.avgCleaningDuration}\n`;
  csvContent += `Average Cleaner Rating,${metrics.avgCleanerRating}\n`;
  csvContent += `Revenue per Cleaner,$${metrics.revenuePerCleaner.toFixed(2)}\n`;
  csvContent += `Revenue per Property,$${metrics.revenuePerProperty.toFixed(2)}\n`;
  csvContent += `Total Bookings,${metrics.totalBookings}\n`;
  csvContent += `Total Revenue,$${metrics.totalRevenue.toFixed(2)}\n`;
  csvContent += `Total Cleaners,${metrics.totalCleaners}\n`;
  csvContent += `Total Properties,${metrics.totalProperties}\n\n`;

  // Booking trends section
  csvContent += 'Booking Trends\n';
  csvContent += 'Date,Bookings,Revenue\n';
  bookingTrends.forEach((trend) => {
    csvContent += `${trend.date},${trend.bookings},$${trend.revenue.toFixed(2)}\n`;
  });

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `analytics-report-${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function exportToPDF(
  bookingTrends: BookingTrendData[],
  metrics: AnalyticsMetrics,
  startDate: Date,
  endDate: Date,
  chartImages?: { bookingTrends?: string; revenueGrowth?: string }
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;

  // Title
  doc.setFontSize(20);
  doc.text('Analytics Report', margin, 30);

  // Date range
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text(
    `Date Range: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
    margin,
    40
  );

  let yPosition = 55;

  // Key Metrics Table
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text('Key Metrics', margin, yPosition);
  yPosition += 10;

  autoTable(doc, {
    startY: yPosition,
    head: [['Metric', 'Value']],
    body: [
      ['Average Cleaning Duration (minutes)', metrics.avgCleaningDuration.toString()],
      ['Average Cleaner Rating', metrics.avgCleanerRating.toFixed(1)],
      ['Revenue per Cleaner', `$${metrics.revenuePerCleaner.toFixed(2)}`],
      ['Revenue per Property', `$${metrics.revenuePerProperty.toFixed(2)}`],
      ['Total Bookings', metrics.totalBookings.toString()],
      ['Total Revenue', `$${metrics.totalRevenue.toFixed(2)}`],
      ['Total Cleaners', metrics.totalCleaners.toString()],
      ['Total Properties', metrics.totalProperties.toString()],
    ],
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246] },
    styles: { fontSize: 10 },
    margin: { left: margin, right: margin },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 20;

  // Booking Trends Table
  if (bookingTrends.length > 0) {
    doc.setFontSize(16);
    doc.text('Booking Trends', margin, yPosition);
    yPosition += 10;

    const trendsBody = bookingTrends.map((trend) => [
      trend.date,
      trend.bookings.toString(),
      `$${trend.revenue.toFixed(2)}`,
    ]);

    autoTable(doc, {
      startY: yPosition,
      head: [['Date', 'Bookings', 'Revenue']],
      body: trendsBody,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });

    yPosition = (doc as any).lastAutoTable.finalY + 20;
  }

  // Add chart images if provided
  if (chartImages?.bookingTrends && yPosition < 250) {
    try {
      doc.addImage(chartImages.bookingTrends, 'PNG', margin, yPosition, contentWidth, 60);
      yPosition += 70;
    } catch (error) {
      console.error('Error adding booking trends chart to PDF:', error);
    }
  }

  if (chartImages?.revenueGrowth && yPosition < 250) {
    try {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Revenue Growth Chart', margin, 30);
      doc.addImage(chartImages.revenueGrowth, 'PNG', margin, 40, contentWidth, 60);
    } catch (error) {
      console.error('Error adding revenue growth chart to PDF:', error);
    }
  }

  // Save PDF
  doc.save(`analytics-report-${new Date().toISOString().split('T')[0]}.pdf`);
}

export function captureChartAsImage(chartId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Find the chart container
    const chartElement = document.querySelector(`[data-chart-id="${chartId}"]`);
    if (!chartElement) {
      reject(new Error('Chart element not found'));
      return;
    }

    // Use html2canvas if available, otherwise use a simpler approach
    // For now, we'll use a canvas-based approach
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    // For Recharts, we can try to get the SVG and convert it
    const svgElement = chartElement.querySelector('svg');
    if (svgElement) {
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG as image'));
      };
      img.src = url;
    } else {
      reject(new Error('SVG element not found in chart'));
    }
  });
}

