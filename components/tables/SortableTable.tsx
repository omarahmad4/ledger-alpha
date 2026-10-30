'use client';

/**
 * @file SortableTable.tsx
 * @description Reusable React hook and custom components to add ascending/descending/none sorting to HTML tables.
 */

import React, { useState, useMemo } from 'react';
import {sortRows,nextSort} from '../../site/lib/ui/table-sort';

export type SortOrder = 'asc' | 'desc' | null;

export interface SortConfig {
  key: string;
  order: SortOrder;
}

/**
 * Helper to resolve nested object values by path string (e.g. 'asset.symbol')
 */
export function getNestedValue(obj: any, path: string): any {
  if (!obj) return undefined;
  return path.split('.').reduce((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    
    // Support Prisma Decimal properties that have a toNumber method
    const val = acc[part];
    if (val && typeof val === 'object' && 'toNumber' in val && typeof val.toNumber === 'function') {
      return val.toNumber();
    }
    return val;
  }, obj);
}

/**
 * Custom hook to sort arrays of data objects dynamically by key or path.
 * Cycles sort order: asc -> desc -> off
 * 
 * @param items The raw array of data objects
 * @param defaultSort Optional default sorting configuration
 */
export function useSortableData<T>(items: T[], defaultSort: SortConfig | null = null) {
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(defaultSort);

  const sortedItems = useMemo(() => sortRows(items, sortConfig?.order ? {key:sortConfig.key,order:sortConfig.order} : null, sortConfig ? [{key:sortConfig.key,value:(row:T)=>getNestedValue(row,sortConfig.key),kind:'auto'}] : []), [items,sortConfig]);

  /** Cycle the selected header without mutating source rows. */
  const requestSort = (key:string) => setSortConfig(current => nextSort(current?.order?{key:current.key,order:current.order}:null,key));

  return { items: sortedItems, requestSort, sortConfig };
}

interface SortableHeaderProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortKey: string;
  sortConfig: SortConfig | null;
  onRequestSort: (key: string) => void;
  children: React.ReactNode;
}

/**
 * Reusable sortable table header <th> element with click toggle and sort icon indicator.
 */
export function SortableHeader({
  sortKey,
  sortConfig,
  onRequestSort,
  children,
  className = '',
  ...props
}: SortableHeaderProps) {
  const isSorted = sortConfig && sortConfig.key === sortKey;
  const order = isSorted ? sortConfig.order : null;

  let indicator = '⇅';
  if (order === 'asc') indicator = '▲';
  if (order === 'desc') indicator = '▼';

  const next=order==='asc'?'descending':order==='desc'?'off':'ascending';
  return (
    <th scope="col" aria-sort={order==='asc'?'ascending':order==='desc'?'descending':'none'} className={`sortable ${className}`} {...props}>
      <button type="button" onClick={()=>onRequestSort(sortKey)} title={`Sort ${next}`} style={{background:'none',border:0,padding:0,color:'inherit',font:'inherit',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>
        <span>{children}</span><span aria-hidden="true" className="sort-indicator" style={{opacity:isSorted?1:0.35,fontSize:10}}>{indicator}</span><span style={{position:'absolute',width:1,height:1,padding:0,margin:-1,overflow:'hidden',clip:'rect(0,0,0,0)',whiteSpace:'nowrap',border:0}}> Sort {next}</span>
      </button>
    </th>
  );
}
