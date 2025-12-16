'use client';

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BookingTrendData } from '../hooks/useAnalyticsData';

// Custom tooltip component positioned next to data point
const CustomTooltip = ({ active, payload, label, coordinate, viewBox }: any) => {
  if (!active || !payload || !payload.length || !coordinate) {
    return null;
  }

  const formatLabel = (value: string) => {
    if (value.includes('Week of')) {
      return `Week of ${value.replace('Week of ', '')}`;
    }
    if (value.includes('-') && value.length === 7) {
      const [year, month] = value.split('-');
      return `${new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    }
    return new Date(value).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Get chart width from viewBox or use coordinate system
  const chartWidth = viewBox?.width || 600;
  const tooltipWidth = 220;
  const offset = 15;
  
  // Determine if tooltip should be on left or right of point
  // If point is in right 60% of chart, show tooltip on left, otherwise on right
  const showOnLeft = coordinate.x > chartWidth * 0.6;
  
  // Calculate horizontal position
  let leftPosition: number;
  if (showOnLeft) {
    leftPosition = coordinate.x - tooltipWidth - offset;
  } else {
    leftPosition = coordinate.x + offset;
  }
  
  // Ensure tooltip doesn't go off screen
  if (leftPosition < 0) {
    leftPosition = offset;
  } else if (leftPosition + tooltipWidth > chartWidth) {
    leftPosition = chartWidth - tooltipWidth - offset;
  }
  
  // Center vertically on the point, with some offset
  const topPosition = Math.max(10, coordinate.y - 50);

  return (
    <div
      style={{
        position: 'absolute',
        left: `${leftPosition}px`,
        top: `${topPosition}px`,
        backgroundColor: 'white',
        border: '1px solid #E5E7EB',
        borderRadius: '8px',
        padding: '12px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        zIndex: 1000,
        width: `${tooltipWidth}px`,
        pointerEvents: 'none',
      }}
    >
      <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#111827', fontSize: '14px' }}>
        {formatLabel(label)}
      </p>
      {payload.map((entry: any, index: number) => (
        <p
          key={index}
          style={{
            margin: '4px 0',
            color: '#374151',
            fontSize: '13px',
          }}
        >
          <span style={{ color: entry.color, marginRight: '8px' }}>●</span>
          {entry.name}: <strong>${entry.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        </p>
      ))}
    </div>
  );
};

interface RevenueGrowthChartProps {
  data: BookingTrendData[];
  loading?: boolean;
}

export default function RevenueGrowthChart({
  data,
  loading,
}: RevenueGrowthChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading chart data...</div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">No revenue data available for the selected period</div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }} tabIndex={-1}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
        data={data}
        margin={{
          top: 5,
          right: 30,
          left: 20,
          bottom: 40,
        }}
      >
        <defs>
          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#10B981" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200" />
        <XAxis
          dataKey="date"
          className="text-xs"
          tick={{ fill: '#6B7280', fontSize: 12 }}
          angle={-45}
          textAnchor="end"
          height={60}
          tickFormatter={(value) => {
            // Format date based on length (day, week, or month)
            if (value.includes('Week of')) {
              const weekStart = value.replace('Week of ', '');
              const date = new Date(weekStart);
              const weekEnd = new Date(date);
              weekEnd.setDate(date.getDate() + 6);
              return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            }
            if (value.includes('-') && value.length === 7) {
              // Month format YYYY-MM
              const [year, month] = value.split('-');
              return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', { 
                month: 'short', 
                year: 'numeric' 
              });
            }
            // Day format - show as "Jan 15" or "Jan 15, 2024" if year is different
            const date = new Date(value);
            const today = new Date();
            const isCurrentYear = date.getFullYear() === today.getFullYear();
            if (isCurrentYear) {
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            } else {
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
            }
          }}
        />
        <YAxis
          className="text-xs"
          tick={{ fill: '#6B7280' }}
          tickFormatter={(value) => `$${value.toLocaleString()}`}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: '#10B981', strokeWidth: 2, strokeDasharray: '5 5' }}
          animationDuration={200}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#10B981"
          strokeWidth={2}
          fillOpacity={0.3}
          fill="#6EE7B7"
          name="Revenue"
          isAnimationActive={true}
          animationBegin={0}
          animationDuration={800}
          animationEasing="ease-out"
        />
      </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

