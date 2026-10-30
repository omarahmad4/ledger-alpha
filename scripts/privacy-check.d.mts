/** Types for the dependency-free offline privacy guard consumed by TypeScript tests. */
export interface PrivacyFinding {path:string;category:string}
/** Inspect one file without returning matched values. */
export function inspectFile(file:string,content:string):PrivacyFinding[];
/** Inspect tracked source and optionally all reachable historical blobs. */
export function inspectRepository(cwd:string,history?:boolean):{files:number;historicalBlobs:number;findings:PrivacyFinding[]};
/** Run the command-line guard using the current working directory. */
export function main():void;
