/** Hosted table hook/header: typed sorting changes presentation only; native buttons supply keyboard semantics. */
'use client';
import {useMemo,useState} from 'react';
import {nextSort,sortRows,type SortColumn,type SortConfig} from './table-sort';
/** Own one table's independent sort state. Off restores the supplied row order exactly.
 * @param rows Canonical filtered rows. @param columns Typed data-column accessors. @param initialSort Initial presentation order, read only on mount. @returns Sorted view and controller. */
export function useTableSort<T>(rows:readonly T[],columns:readonly SortColumn<T>[],initialSort:SortConfig|null=null){
 const [sortConfig,setSortConfig]=useState<SortConfig|null>(initialSort);
 const items=useMemo(()=>sortRows(rows,sortConfig,columns),[rows,columns,sortConfig]);
 return {items,sortConfig,requestSort:(key:string)=>setSortConfig(current=>nextSort(current,key))};
}
/** Accessible sortable column header; no click handler is attached to table rows or ledger actions.
 * @param props Column label/key and table controller. @returns A column-scoped header with visible sort state. */
export function SortableHeader({label,sortKey,sortConfig,requestSort}:{label:string;sortKey:string;sortConfig:SortConfig|null;requestSort:(key:string)=>void}){
 const order=sortConfig?.key===sortKey?sortConfig.order:null;const next=order==='asc'?'descending':order==='desc'?'off':'ascending';
 return <th scope="col" aria-sort={order==='asc'?'ascending':order==='desc'?'descending':'none'} data-sort-key={sortKey}><button type="button" className="sort-button" onClick={()=>requestSort(sortKey)} aria-label={`${label}: sort ${next}`} title={`Sort ${next}`}><span>{label}</span><span aria-hidden="true" className="sort-indicator">{order==='asc'?'↑':order==='desc'?'↓':'↕'}</span></button></th>;
}
