'use client';

/**
 * @file DecisionsPageClient.tsx
 * @description Interactive client wrapper for DecisionsPage.
 * Implements column-level sorting and a toggle to hide automatic dividend reinvestments.
 */

import React, { useState } from 'react';
import { money, number, pct } from '@/lib/format';
import { useSortableData, SortableHeader } from '@/components/tables/SortableTable';
import { Tooltip as InfoTooltip } from '@/components/Tooltip';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts';

interface DecisionsPageClientProps {
  initialDecisionRows: any[];
}

export function DecisionsPageClient({ initialDecisionRows }: DecisionsPageClientProps) {
  const [hideReinvestments, setHideReinvestments] = useState(true);
  const [hideClosed, setHideClosed] = useState(false);
  const [weightMode, setWeightMode] = useState<'unweighted' | 'weighted'>('unweighted');

  // 1. Filter out dividend reinvestments and/or closed decisions if toggled
  const filteredRows = React.useMemo(() => {
    let rows = initialDecisionRows;
    if (hideReinvestments) {
      rows = rows.filter((row) => row.notes !== 'Dividend Reinvestment');
    }
    if (hideClosed) {
      rows = rows.filter((row) => row.isActive);
    }
    return rows;
  }, [initialDecisionRows, hideReinvestments, hideClosed]);

  // 2. Hook up sorting
  const { items: sortedRows, requestSort, sortConfig } = useSortableData(filteredRows, {
    key: 'excessReturnPct',
    order: 'desc'
  });

  // Calculate live decision KPIs from current filtered selection (supports Value-Weighting)
  const totalDecisions = sortedRows.length;
  const gpaValues: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

  let beatRate = 0.0;
  let avgGPA = 0.0;
  let overallAlpha = 0.0;

  if (totalDecisions > 0) {
    if (weightMode === 'weighted') {
      const totalWeight = sortedRows.reduce((acc, r: any) => acc + Math.abs(r.grossAmount), 0);
      if (totalWeight > 0) {
        const beatWeightSum = sortedRows
          .filter((d: any) => d.excessReturnPct > 0)
          .reduce((acc, r: any) => acc + Math.abs(r.grossAmount), 0);
        beatRate = beatWeightSum / totalWeight;

        const weightedGPASum = sortedRows.reduce((acc, r: any) => acc + (gpaValues[r.grade] ?? 0) * Math.abs(r.grossAmount), 0);
        avgGPA = weightedGPASum / totalWeight;

        const weightedAlphaSum = sortedRows.reduce((acc, r: any) => acc + r.excessReturnPct * Math.abs(r.grossAmount), 0);
        overallAlpha = weightedAlphaSum / totalWeight;
      }
    } else {
      const beatCount = sortedRows.filter((d: any) => d.excessReturnPct > 0).length;
      beatRate = beatCount / totalDecisions;

      const totalGPA = sortedRows.reduce((acc, r: any) => acc + (gpaValues[r.grade] ?? 0), 0);
      avgGPA = totalGPA / totalDecisions;

      const alphaSum = sortedRows.reduce((acc, r: any) => acc + r.excessReturnPct, 0);
      overallAlpha = alphaSum / totalDecisions;
    }
  }

  const getLetterGPA = (gpa: number) => {
    if (gpa >= 3.5) return 'A';
    if (gpa >= 2.5) return 'B';
    if (gpa >= 1.5) return 'C';
    if (gpa >= 0.5) return 'D';
    return 'F';
  };

  const decisionChartData = React.useMemo(() => {
    const chronological = [...filteredRows].sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());
    return chronological.map((row, idx, arr) => {
      const alpha = (row.excessReturnPct ?? 0) * 100;
      const startIdx = Math.max(0, idx - 4);
      const windowRows = arr.slice(startIdx, idx + 1);
      const rollingAvg = windowRows.reduce((sum, r) => sum + (r.excessReturnPct ?? 0), 0) / windowRows.length * 100;
      return {
        date: new Date(row.tradeDate).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        alpha,
        rollingAvg,
        symbol: row.symbol,
      };
    });
  }, [filteredRows]);

  return (
    <>
      {/* Decisions Quality Timeline Chart */}
      <section className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, marginBottom: 6, display: 'flex', alignItems: 'center' }}>
          Decision Quality Timeline
          <InfoTooltip text="Plots the excess return (alpha) of each buy decision on its trade date. The rolling average line shows the smoothed quality trend of your investment decisions over time." />
        </h3>
        <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: 0, marginBottom: 20 }}>
          Timeline of investment outperformance (Alpha) compared to S&P 500 (SPY).
        </p>

        {decisionChartData.length === 0 ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '40px 0' }}>
            No decisions available for the current filters.
          </div>
        ) : (
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={decisionChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis 
                  dataKey="date" 
                  stroke="#64748b" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false} 
                />
                <YAxis 
                  stroke="#64748b" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(val) => `${val.toFixed(0)}%`} 
                />
                <RechartsTooltip 
                  contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }} 
                  labelStyle={{ fontWeight: 600, color: '#cbd5e1' }}
                  formatter={(value, name) => {
                    const label = name === 'alpha' ? 'Decision Alpha' : '5-Decision Rolling Avg';
                    return [`${Number(value).toFixed(2)}%`, label];
                  }}
                />
                <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 13 }} />
                <Line 
                  type="monotone" 
                  dataKey="alpha" 
                  name="alpha" 
                  stroke="#64748b" 
                  strokeWidth={1} 
                  dot={{ r: 3, stroke: '#64748b', strokeWidth: 1, fill: '#0f172a' }}
                  activeDot={{ r: 5 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="rollingAvg" 
                  name="rollingAvg" 
                  stroke="#10b981" 
                  strokeWidth={2.5} 
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Decision KPIs */}
      <section className="grid" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center' }}>
            Average Portfolio Grade
            <InfoTooltip text="The capital-weighted GPA of your buy decisions (A=4.00, B=3.00, C=2.00, D=1.00, F=0.00). Staged cost determines the weight." />
          </h3>
          <div className="metric" style={{ color: avgGPA >= 2.5 ? '#10b981' : '#fde68a' }}>
            {avgGPA.toFixed(2)} / 4.00 <span style={{ fontSize: '18px', fontWeight: 500 }}>({getLetterGPA(avgGPA)})</span>
          </div>
        </div>
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center' }}>
            Alpha Beat Rate
            <InfoTooltip text="The percentage of your investment cohorts (or capital, if weighted) that outperformed the S&P 500 (SPY) benchmark index." />
          </h3>
          <div className="metric" style={{ color: beatRate >= 0.5 ? '#10b981' : '#f59e0b' }}>
            {pct(beatRate)} <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 400 }}>of {weightMode === 'weighted' ? 'capital outperforms' : 'cohorts outperform'} SPY</span>
          </div>
        </div>
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center' }}>
            Average Excess Return (Alpha)
            <InfoTooltip text="The average percentage return of your investment cohorts minus the S&P 500's return over the same holding periods." />
          </h3>
          <div className={`metric ${overallAlpha >= 0 ? 'positive' : 'negative'}`}>
            {overallAlpha >= 0 ? '+' : ''}{pct(overallAlpha)}
          </div>
        </div>
      </section>

      {/* Decision Table */}
      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Decision Scorecards</h3>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Weighting:</span>
              <select
                value={weightMode}
                onChange={(e) => setWeightMode(e.target.value as any)}
                style={{ background: '#1e293b', color: '#cbd5e1', padding: '4px 8px', borderRadius: '6px', border: '1px solid #475569', fontSize: '13px', cursor: 'pointer' }}
                data-testid="select-weighting"
              >
                <option value="unweighted">Unweighted</option>
                <option value="weighted">Weighted by Value</option>
              </select>
            </div>
            <label className="checkbox-row" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input 
                type="checkbox" 
                checked={hideClosed} 
                onChange={(e) => setHideClosed(e.target.checked)} 
                data-testid="toggle-closed-decisions"
              />
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Hide Closed Decisions</span>
            </label>
            <label className="checkbox-row" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input 
                type="checkbox" 
                checked={hideReinvestments} 
                onChange={(e) => setHideReinvestments(e.target.checked)} 
                data-testid="toggle-reinvestments"
              />
              <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Hide Dividend Reinvestments</span>
            </label>
          </div>
        </div>

        {sortedRows.length === 0 ? (
          <div className="empty-state" style={{ textAlign: 'center', padding: '40px 0' }}>
            No BUY decisions found. Try toggling off the reinvestment filter or importing data.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <SortableHeader sortKey="grade" sortConfig={sortConfig} onRequestSort={requestSort}>Grade</SortableHeader>
                <SortableHeader sortKey="symbol" sortConfig={sortConfig} onRequestSort={requestSort}>Asset</SortableHeader>
                <SortableHeader sortKey="tradeDate" sortConfig={sortConfig} onRequestSort={requestSort}>Trade Date</SortableHeader>
                <SortableHeader sortKey="quantity" sortConfig={sortConfig} onRequestSort={requestSort}>Original Qty</SortableHeader>
                <SortableHeader sortKey="grossAmount" sortConfig={sortConfig} onRequestSort={requestSort}>Staged Cost</SortableHeader>
                <SortableHeader sortKey="actualValue" sortConfig={sortConfig} onRequestSort={requestSort}>Current Value</SortableHeader>
                <SortableHeader sortKey="actualReturnPct" sortConfig={sortConfig} onRequestSort={requestSort}>Actual Return</SortableHeader>
                <SortableHeader sortKey="benchmarkReturnPct" sortConfig={sortConfig} onRequestSort={requestSort}>SPY Return</SortableHeader>
                <SortableHeader sortKey="excessReturnPct" sortConfig={sortConfig} onRequestSort={requestSort}>Excess Return</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row: any) => {
                const actualVal = row.actualValue ?? 0;
                const invested = row.grossAmount ?? 0;
                const actReturn = row.actualReturnPct ?? 0;
                const bmkReturn = row.benchmarkReturnPct ?? 0;
                const excess = row.excessReturnPct ?? 0;

                return (
                  <tr key={row.id}>
                    <td>
                      <span className={`grade grade-${row.grade.toLowerCase()}`}>
                        {row.grade}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{row.symbol}</td>
                    <td suppressHydrationWarning>{new Date(row.tradeDate).toLocaleDateString()}</td>
                    <td>{number(row.quantity)}</td>
                    <td>{money(invested)}</td>
                    <td style={{ fontWeight: 500 }}>{money(actualVal)}</td>
                    <td className={actReturn >= 0 ? 'positive' : 'negative'}>
                      {pct(actReturn)}
                    </td>
                    <td style={{ color: '#cbd5e1' }}>{pct(bmkReturn)}</td>
                    <td className={excess >= 0 ? 'positive' : 'negative'} style={{ fontWeight: 600 }}>
                      {excess >= 0 ? '+' : ''}{pct(excess)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
